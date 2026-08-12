# Kafka Message Collector — Design

## Overview

This is Sub-Project Step 1 of a larger, four-step initiative (Consumer module → Baseline Store → Diff Engine → Integration into the existing test-run flow) aimed at building automated Kafka contract/regression verification for test runs — a **new, separate capability** from the existing ad-hoc Kafka Check Tracking system (`KafkaCheckStore`, the long-lived shared consumer, the Manual Check page). The two coexist; this does not replace anything that exists today.

The user's original outline was Python/pytest-flavored (`kafka-python`, `capture_baseline.py`, `dataclass`, Testcontainers, background threads); this project is TypeScript/Node.js throughout, so every concept here is translated to that stack (`kafkajs`, TypeScript interfaces, Vitest, native Promises).

This step builds one independent, reusable module: given a topic, a `transId` to watch for, and termination criteria, it spins up a brand-new Kafka consumer, collects every matching message until termination, and returns them. It has no knowledge of baselines, diffing, or test-runner integration — those are later steps.

## Architecture & Placement

- New file: `packages/server/src/kafka-message-collector.ts`, in the existing server package (not a new monorepo package) — it reuses the `kafkajs` dependency already installed there and has no reason to be consumed by `packages/web`.
- Exports a single function, `collectKafkaMessages(options): Promise<CollectKafkaMessagesResult>`. No class, no separate start/stop handles — connect, seek, collect, terminate, and disconnect all happen inside the one async call, resolving with the final result.
- Every call creates a brand-new `Kafka` client and consumer with a freshly generated, unique `group.id` (e.g. `verifier-${randomUUID()}`), so concurrent calls (e.g. parallel test runs) never share a consumer group or interfere with each other's offsets.
- The module is environment-agnostic: callers pass a resolved `{ brokers, topic }` directly. Reading environment-specific config (local/staging) from somewhere is a concern for whoever calls this module, not this module itself.

**Running non-blocking / in parallel with other test steps:** this falls out of the design for free and needs no extra mechanism. `collectKafkaMessages` returns a Promise, and — unlike Python, where running something in the background requires an explicit thread or `asyncio.create_task()` — a JS/TS Promise begins executing the moment it's created, regardless of when (or whether) the caller awaits it. So a caller gets background execution simply by not awaiting immediately:

```ts
const collectorPromise = collectKafkaMessages({ transId, topic, ... }); // starts running now
await confirmPay();  // other steps proceed concurrently, "for free" time for the Kafka message to arrive
await getOrder();
const result = await collectorPromise; // only now does the caller actually wait for it
```

No background-thread API is exposed by this module — the caller controls concurrency entirely through ordinary `await` placement.

## Public API

```ts
interface CollectKafkaMessagesOptions {
  brokers: string[];
  topic: string;
  transId: string;
  correlatorField: string;      // e.g. 'appTransID' — field name to match transId against
  statusField: string;          // e.g. 'status' — field to read each message's status from
  terminalStatuses: string[];   // e.g. ['SUCCESS'] for a happy-path test, or ['SUCCESS', 'FAILED', 'PENDING'] more broadly
  idleTimeoutMs: number;        // e.g. 15000 — caller-supplied; see "Choosing idleTimeoutMs" below
  startFromMs?: number;         // defaults to Date.now() if omitted
}

interface CollectKafkaMessagesResult {
  messages: unknown[];          // matching messages, in arrival order
  receivedStatuses: string[];   // distinct statuses observed among matching messages
  terminatedBy: 'terminal-status' | 'idle-timeout';
  durationMs: number;           // wall-clock time from call start to termination
}

function collectKafkaMessages(options: CollectKafkaMessagesOptions): Promise<CollectKafkaMessagesResult>;
```

## Data Flow

1. Generate a unique `group.id`.
2. Connect and subscribe to `topic` with `fromBeginning: false`.
3. Use a Kafka admin client to resolve the partition offsets at `startFromMs` (`fetchTopicOffsetsByTimestamp`), then `seek()` each assigned partition to that offset once the consumer group has joined — this closes the race where group-join/rebalance overhead (which can take up to a second or two) would otherwise cause `fromBeginning: false`'s natural "start from now" behavior to miss messages produced right as the caller triggers whatever real action it's verifying.
4. For every incoming message: parse as JSON; if parsing fails, skip it silently (matches this project's existing `handleIncomingMessage` behavior) and it does not affect the idle timer.
5. Check `message[correlatorField]` against `transId`. Non-matching messages are ignored entirely — not collected, and they do **not** reset the idle timer (the timer tracks silence specific to this transaction, not general topic traffic).
6. Each **matching** message is appended to the result's `messages` array, its `statusField` value is recorded into `receivedStatuses` (deduplicated), and the idle timer resets.
7. If a matching message's status is in `terminalStatuses`, resolve immediately with `terminatedBy: 'terminal-status'` — this stops on the *first* terminal status seen (e.g. a happy-path test passing `terminalStatuses: ['SUCCESS']` stops the moment `SUCCESS` arrives, without waiting out the full idle timeout), not after observing a full expected sequence.
8. If `idleTimeoutMs` elapses with no new matching message, resolve with `terminatedBy: 'idle-timeout'`.
9. The consumer always disconnects before the returned promise settles, on both the success and error paths.
10. `durationMs` is measured from the start of the call to whichever termination condition fired, and included in the result either way.

## Choosing `idleTimeoutMs`

This module never guesses or hardcodes a default — `idleTimeoutMs` is always caller-supplied. Picking a good value is an empirical exercise for whoever calls this module (e.g. run a representative test 5-10+ times, use the `durationMs` from each real result to compute p99, set the timeout to roughly that plus a buffer, and revisit periodically as system performance shifts) — `durationMs` is included in every result specifically so that practice is possible without separate instrumentation. This module itself has no opinion on what a "good" timeout value is.

## Error Handling

- A connection failure (e.g. unreachable broker) rejects the promise with the underlying error — no silent retry or degradation, since a caller needs to distinguish "no message arrived" from "couldn't even connect."
- Malformed JSON on a message is skipped silently, as described above.

## Testing

- `kafkajs` is mocked (`vi.mock('kafkajs')`), matching every other Kafka test in this project — there is no Docker/Testcontainers available in this development environment, so real-broker seek/offset behavior is not verified against an actual broker as part of this increment. That would need a separate follow-up, run wherever Docker is actually available.
- Test coverage: only matching messages are collected (non-matching ones are ignored and don't reset the timer); the idle timer fires and resolves with `terminatedBy: 'idle-timeout'` when no matching message arrives in time; a terminal-status message resolves immediately with `terminatedBy: 'terminal-status'` even if `idleTimeoutMs` hasn't elapsed; two separate calls generate two different `group.id` values; malformed JSON is skipped without crashing the collection loop; `durationMs` is present and roughly matches elapsed wall-clock time in a result.
