# Kafka Diff Engine Design

## Context

This is Step 3 of 4 in the Kafka contract-testing initiative (Consumer module → Baseline Store → **Diff Engine** → Integration). It builds on Step 2's baseline JSON files (`kafka-baselines/{version}/{status}.json`, written by `packages/web/scripts/write-baseline.ts`) to compare a "known-good" set of Kafka messages against a new set of actual messages, and report the differences with severity.

Scope for this step is **pure comparison only** — given two already-captured message sets, produce a diff report. Triggering a live run, calling `collectKafkaMessages`, and wiring this into the real test-run flow automatically is Step 4's job, not this one.

## Architecture

`diffKafkaMessages(baselineMessages, actualMessages, topic)` is a pure function in `packages/server/src/kafka-diff-engine.ts`, alongside `kafka-check-logic.ts`. It has zero I/O — no fetch, no fs, no Kafka client — so it's independently unit-testable and reusable from both this step's CLI script and Step 4's live integration.

It reuses `KAFKA_TOPIC_DEFINITIONS` (`hasDataWrapper`/`correlatorFields`) and the payload-unwrapping logic currently private to `kafka-check-logic.ts`. That logic is exported as `payloadOf(message, topic)` (renamed from its current private form) so both modules share one unwrapping implementation, rather than duplicating it — this codebase has hit real bugs from duplicated conversion logic before (see the "Duplicated record-conversion gotcha" in project memory).

Flow: unwrap every message's payload on both sides → pair baseline messages to actual messages by their `status` field value → for each pair, compare fields (minus ignored ones) → collect findings → compute overall `passed`/`failed`.

## Data Structures & API

```ts
export type DiffSeverity = 'critical' | 'warning' | 'info';

export type DiffFindingKind =
  | 'missing-message'   // status present in baseline, absent in actual        → critical
  | 'extra-message'     // status present in actual, absent in baseline       → info
  | 'missing-field'     // field present in baseline message, absent in actual → critical
  | 'extra-field'       // field present in actual message, absent in baseline → info
  | 'changed-field';    // field present in both, different value              → warning

export interface DiffFinding {
  kind: DiffFindingKind;
  status: string;            // the status this finding is scoped to
  field?: string;            // present for missing-field/extra-field/changed-field only
  severity: DiffSeverity;
  baselineValue?: unknown;   // present where relevant
  actualValue?: unknown;     // present where relevant
}

export interface DiffReport {
  result: 'passed' | 'failed';   // 'failed' iff any finding has severity 'critical'
  findings: DiffFinding[];
}

export function diffKafkaMessages(
  baselineMessages: unknown[],
  actualMessages: unknown[],
  topic: KafkaTopicKey
): DiffReport
```

Severity is fixed by `kind` — there is no per-call override. `extra-message` findings carry only `actualValue` (the whole extra message); `missing-message` findings carry only `baselineValue`.

## Matching & Ignore-List Mechanics

**Pairing:** unwrap every message's payload, read its `status` field (hardcoded field name `'status'`, matching the existing convention in `baseline-capture-core.ts`/`collectKafkaMessages`). Group each side's messages by status value.

- A status present in baseline's groups but not actual's → one `missing-message` finding.
- A status present in actual's groups but not baseline's → one `extra-message` finding.
- A status present in both → proceed to field-level comparison.
- If a status appears more than once on either side (e.g. a retried message), use the **first** occurrence for comparison. Additional duplicates beyond the first are silently ignored — not reported as extra-message noise.

**Field comparison (per matched pair):** take the union of both payloads' top-level keys, minus ignored fields. For each remaining key:
- present in baseline only → `missing-field`
- present in actual only → `extra-field`
- present in both, `JSON.stringify`-equal values → no finding
- present in both, different values → `changed-field` (whole before/after value attached; no recursion into nested objects/arrays — a nested-object field that differs anywhere inside it is reported as one `changed-field` finding for that top-level key, not broken into per-nested-path findings)

**Ignore list** — two layers, both skipped during field comparison:
1. A global suffix rule: any field name ending in `"time"` or `"date"`, case-insensitive (catches `appTime`, `reqDate`, `updDate`, `sourceAssetCreateTime`, etc. without enumerating them).
2. A per-topic exact-name list, `KafkaTopicDefinition.diffIgnoreFields` (new optional field in `kafka-check-definitions.ts`) — defaults to that topic's `correlatorFields` (`appTransID`/`transID` for `transLogV1`/`refundLog`, `order_no` for `paymentAuth`), extensible for future one-off exceptions.

## CLI Script

`packages/web/scripts/compare-baselines.ts`, mirroring `capture-baseline.ts`'s shape via `node:util`'s `parseArgs`:

```
tsx scripts/compare-baselines.ts --baseline <path> --actual <path> --topic <transLogV1|refundLog|paymentAuth>
```

Both `--baseline` and `--actual` point at files matching the baseline JSON shape written by `write-baseline.ts`/`update-baseline.ts` (`{ capturedAt, version, status, durationMs, messages }`) — `--actual` can point at a second real baseline file, or any file in that same shape (e.g. a fresh capture written to a scratch location). The script reads both files, calls `diffKafkaMessages(baseline.messages, actual.messages, topic)`, prints one line per finding (severity, kind, status, field, before/after), and exits with code 0 if `passed`, code 1 if `failed` — CI-friendly even though wiring it into an actual pipeline is Step 4's job.

A new npm script is added to `packages/web/package.json`: `"compare-baselines": "tsx scripts/compare-baselines.ts"`.

## Testing

Table-driven unit tests in `packages/server/test/kafka-diff-engine.test.ts`, using real `transLogV1`/`paymentAuth` message shapes already established elsewhere in this codebase's Kafka tests:

- identical baseline/actual → `passed`, no findings
- a status missing from actual → `missing-message`, critical, overall `failed`
- a status present only in actual → `extra-message`, info, overall stays `passed` if nothing else critical
- a field missing from a matched actual message → `missing-field`, critical, overall `failed`
- a field present only in a matched actual message → `extra-field`, info
- a field with a different value in a matched pair → `changed-field`, warning, overall stays `passed` if nothing else critical
- a field differing only in an ignored-suffix name (e.g. `updDate`) → not reported at all
- a field differing only in the topic's correlator field (e.g. `appTransID`) → not reported at all
- a duplicate-status message on either side → first occurrence used for comparison, no extra-message noise from the duplicate
- overall `result` is `failed` only when at least one critical finding exists — a report with only warning/info findings is `passed`

For the CLI script: a manual smoke test (no automated test needed, matching this codebase's established pattern for `capture-baseline.ts`) — run `compare-baselines.ts` against two real baseline-shaped fixture files and confirm the printed report and exit code are correct.

## Error Handling

The CLI throws with a clear message (same style as `capture-baseline.ts`'s existing checks) if `--baseline`/`--actual`/`--topic` are missing, or if either file can't be read or parsed as JSON — before ever calling `diffKafkaMessages`.

`diffKafkaMessages` itself never throws. It only ever receives `messages: unknown[]` arrays that came from `collectKafkaMessages`/baseline files, which already only ever contain valid parsed JSON objects (see `payloadOf`'s existing type guards) — a message that fails to unwrap to a payload object is simply excluded from pairing/comparison, the same defensive behavior `payloadOf` already has today.
