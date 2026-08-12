# Kafka Message Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `collectKafkaMessages`, an independent, reusable module that spins up a brand-new Kafka consumer per call, collects every message matching a given `transId`, and terminates on either a terminal status or an idle timeout — Step 1 of the larger Kafka contract-testing initiative (Consumer module → Baseline Store → Diff Engine → Integration).

**Architecture:** One new file in `packages/server/src/`, one exported async function, no new backend routes, no changes to any existing Kafka code (`kafka-consumer.ts`, `kafka-check-store.ts`, etc. are untouched — this is a wholly separate, coexisting capability).

**Tech Stack:** TypeScript (`packages/server`), `kafkajs` (already a dependency), Vitest with mocked `kafkajs` (no Docker/Testcontainers available in this environment).

## Global Constraints

- This module must not import from or modify anything under the existing Kafka Check Tracking feature (`kafka-check-store.ts`, `kafka-consumer.ts`, `kafka-check-logic.ts`, `kafka-check-definitions.ts`, `translog-required-fields.ts`) — it is a new, separate capability, confirmed during brainstorming to coexist rather than replace.
- No background-thread/task API is exposed — a caller gets concurrent execution simply by not awaiting the returned promise immediately (a property of JS/TS Promises, not something this module implements).
- `idleTimeoutMs` is always caller-supplied; this module never hardcodes or guesses a default value.
- TDD: write the failing tests, run them, confirm the failure, implement, run again, confirm the pass, typecheck, commit.

---

### Task 1: `collectKafkaMessages`

**Files:**
- Create: `packages/server/src/kafka-message-collector.ts`
- Test: `packages/server/test/kafka-message-collector.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CollectKafkaMessagesOptions {
    brokers: string[];
    topic: string;
    transId: string;
    correlatorField: string;
    statusField: string;
    terminalStatuses: string[];
    idleTimeoutMs: number;
    startFromMs?: number;
  }

  export interface CollectKafkaMessagesResult {
    messages: unknown[];
    receivedStatuses: string[];
    terminatedBy: 'terminal-status' | 'idle-timeout';
    durationMs: number;
  }

  export function collectKafkaMessages(options: CollectKafkaMessagesOptions): Promise<CollectKafkaMessagesResult>;
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/kafka-message-collector.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectKafkaMessages, type CollectKafkaMessagesOptions } from '../src/kafka-message-collector.js';

const mocks = vi.hoisted(() => {
  return {
    consumerMock: {
      connect: vi.fn(),
      subscribe: vi.fn(),
      run: vi.fn(),
      on: vi.fn(),
      events: { GROUP_JOIN: 'consumer.group_join' },
      seek: vi.fn(),
      disconnect: vi.fn(),
    },
    adminMock: {
      connect: vi.fn(),
      fetchTopicOffsetsByTimestamp: vi.fn(),
      disconnect: vi.fn(),
    },
    consumerFactory: vi.fn(),
    kafkaConstructorMock: vi.fn(),
  };
});

vi.mock('kafkajs', () => ({
  Kafka: mocks.kafkaConstructorMock,
}));

function captureEachMessage() {
  const calls = mocks.consumerMock.run.mock.calls;
  const call = calls[calls.length - 1];
  if (!call) {
    throw new Error('consumer.run was never called');
  }
  return call[0].eachMessage as (payload: { message: { value: Buffer } }) => Promise<void>;
}

function messagePayload(data: Record<string, unknown>) {
  return { message: { value: Buffer.from(JSON.stringify(data)) } };
}

function baseOptions(overrides: Partial<CollectKafkaMessagesOptions> = {}): CollectKafkaMessagesOptions {
  return {
    brokers: ['broker:9092'],
    topic: 'transLogV1',
    transId: 'tx-1',
    correlatorField: 'appTransID',
    statusField: 'status',
    terminalStatuses: ['SUCCESS'],
    idleTimeoutMs: 15_000,
    ...overrides,
  };
}

describe('collectKafkaMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumerMock.connect.mockResolvedValue(undefined);
    mocks.consumerMock.subscribe.mockResolvedValue(undefined);
    mocks.consumerMock.run.mockResolvedValue(undefined);
    mocks.consumerMock.disconnect.mockResolvedValue(undefined);
    mocks.adminMock.connect.mockResolvedValue(undefined);
    mocks.adminMock.fetchTopicOffsetsByTimestamp.mockResolvedValue([{ partition: 0, offset: '100' }]);
    mocks.adminMock.disconnect.mockResolvedValue(undefined);
    mocks.consumerFactory.mockReturnValue(mocks.consumerMock);
    mocks.kafkaConstructorMock.mockImplementation(() => ({
      consumer: mocks.consumerFactory,
      admin: () => mocks.adminMock,
    }));
  });

  it('ignores non-matching messages, which do not reset the idle timer, and times out', async () => {
    vi.useFakeTimers();
    try {
      const resultPromise = collectKafkaMessages(baseOptions());
      await vi.advanceTimersByTimeAsync(0);
      const eachMessage = captureEachMessage();

      await eachMessage(messagePayload({ appTransID: 'some-other-tx', status: 'SUCCESS' }));
      await vi.advanceTimersByTimeAsync(15_000);

      const result = await resultPromise;
      expect(result.messages).toEqual([]);
      expect(result.terminatedBy).toBe('idle-timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('collects a matching message and resolves immediately on a terminal status', async () => {
    vi.useFakeTimers();
    try {
      const resultPromise = collectKafkaMessages(baseOptions());
      await vi.advanceTimersByTimeAsync(0);
      const eachMessage = captureEachMessage();

      await eachMessage(messagePayload({ appTransID: 'tx-1', status: 'SUCCESS' }));

      const result = await resultPromise;
      expect(result.messages).toEqual([{ appTransID: 'tx-1', status: 'SUCCESS' }]);
      expect(result.receivedStatuses).toEqual(['SUCCESS']);
      expect(result.terminatedBy).toBe('terminal-status');
      expect(mocks.consumerMock.disconnect).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the idle timer on each matching non-terminal message, and times out after the last one', async () => {
    vi.useFakeTimers();
    try {
      const resultPromise = collectKafkaMessages(baseOptions());
      await vi.advanceTimersByTimeAsync(0);
      const eachMessage = captureEachMessage();

      await eachMessage(messagePayload({ appTransID: 'tx-1', status: 'CREATED' }));
      await vi.advanceTimersByTimeAsync(10_000);
      await eachMessage(messagePayload({ appTransID: 'tx-1', status: 'PROCESSING' }));
      await vi.advanceTimersByTimeAsync(15_000);

      const result = await resultPromise;
      expect(result.messages).toHaveLength(2);
      expect(result.receivedStatuses).toEqual(['CREATED', 'PROCESSING']);
      expect(result.terminatedBy).toBe('idle-timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips a message with malformed JSON without crashing', async () => {
    vi.useFakeTimers();
    try {
      const resultPromise = collectKafkaMessages(baseOptions());
      await vi.advanceTimersByTimeAsync(0);
      const eachMessage = captureEachMessage();

      await eachMessage({ message: { value: Buffer.from('not json') } });
      await vi.advanceTimersByTimeAsync(15_000);

      const result = await resultPromise;
      expect(result.messages).toEqual([]);
      expect(result.terminatedBy).toBe('idle-timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('includes durationMs reflecting elapsed time to termination', async () => {
    vi.useFakeTimers();
    try {
      const resultPromise = collectKafkaMessages(baseOptions());
      await vi.advanceTimersByTimeAsync(0);
      const eachMessage = captureEachMessage();
      await vi.advanceTimersByTimeAsync(5_000);
      await eachMessage(messagePayload({ appTransID: 'tx-1', status: 'SUCCESS' }));

      const result = await resultPromise;
      expect(result.durationMs).toBeGreaterThanOrEqual(5_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('seeks each partition to the resolved offset once the consumer group joins', async () => {
    vi.useFakeTimers();
    try {
      mocks.adminMock.fetchTopicOffsetsByTimestamp.mockResolvedValue([
        { partition: 0, offset: '250' },
        { partition: 1, offset: '300' },
      ]);
      const resultPromise = collectKafkaMessages(baseOptions());
      await vi.advanceTimersByTimeAsync(0);

      const onCall = mocks.consumerMock.on.mock.calls.find(
        ([eventName]) => eventName === mocks.consumerMock.events.GROUP_JOIN
      );
      expect(onCall).toBeDefined();
      onCall![1]();

      expect(mocks.consumerMock.seek).toHaveBeenCalledWith({ topic: 'transLogV1', partition: 0, offset: '250' });
      expect(mocks.consumerMock.seek).toHaveBeenCalledWith({ topic: 'transLogV1', partition: 1, offset: '300' });

      const eachMessage = captureEachMessage();
      await eachMessage(messagePayload({ appTransID: 'tx-1', status: 'SUCCESS' }));
      await resultPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects when the consumer fails to connect, and still attempts to disconnect', async () => {
    mocks.consumerMock.connect.mockRejectedValue(new Error('connection timeout'));

    await expect(collectKafkaMessages(baseOptions())).rejects.toThrow('connection timeout');
    expect(mocks.consumerMock.disconnect).toHaveBeenCalled();
  });

  it('generates a different group.id for each call', async () => {
    vi.useFakeTimers();
    try {
      const p1 = collectKafkaMessages(baseOptions());
      await vi.advanceTimersByTimeAsync(0);
      await captureEachMessage()(messagePayload({ appTransID: 'tx-1', status: 'SUCCESS' }));
      await p1;
      const firstGroupId = mocks.consumerFactory.mock.calls[0][0].groupId;

      const p2 = collectKafkaMessages(baseOptions());
      await vi.advanceTimersByTimeAsync(0);
      await captureEachMessage()(messagePayload({ appTransID: 'tx-1', status: 'SUCCESS' }));
      await p2;
      const secondGroupId = mocks.consumerFactory.mock.calls[1][0].groupId;

      expect(firstGroupId).not.toBe(secondGroupId);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

Note: this is the first use of `vi.hoisted` in this codebase — it's necessary here (unlike the existing `vi.mock('kafkajs', ...)` in `kafka-consumer.test.ts`) because these tests need to reach into and manipulate the mock's captured call arguments (`eachMessage`, the `GROUP_JOIN` handler, `groupId`) from inside each test body, not just control what the mock returns.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test -- kafka-message-collector.test.ts`
Expected: FAIL — `../src/kafka-message-collector.js` does not exist yet.

- [ ] **Step 3: Implement `collectKafkaMessages`**

Create `packages/server/src/kafka-message-collector.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { Kafka } from 'kafkajs';

export interface CollectKafkaMessagesOptions {
  brokers: string[];
  topic: string;
  transId: string;
  correlatorField: string;
  statusField: string;
  terminalStatuses: string[];
  idleTimeoutMs: number;
  startFromMs?: number;
}

export interface CollectKafkaMessagesResult {
  messages: unknown[];
  receivedStatuses: string[];
  terminatedBy: 'terminal-status' | 'idle-timeout';
  durationMs: number;
}

export async function collectKafkaMessages(
  options: CollectKafkaMessagesOptions
): Promise<CollectKafkaMessagesResult> {
  const startedAt = Date.now();
  const startFromMs = options.startFromMs ?? startedAt;
  const kafka = new Kafka({ brokers: options.brokers });
  const consumer = kafka.consumer({ groupId: `verifier-${randomUUID()}` });
  const admin = kafka.admin();

  const messages: unknown[] = [];
  const receivedStatuses = new Set<string>();

  return new Promise<CollectKafkaMessagesResult>((resolve, reject) => {
    let idleTimer: ReturnType<typeof setTimeout>;
    let settled = false;

    function finish(terminatedBy: 'terminal-status' | 'idle-timeout') {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(idleTimer);
      const result: CollectKafkaMessagesResult = {
        messages,
        receivedStatuses: [...receivedStatuses],
        terminatedBy,
        durationMs: Date.now() - startedAt,
      };
      consumer
        .disconnect()
        .catch(() => {})
        .finally(() => resolve(result));
    }

    function resetIdleTimer() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish('idle-timeout'), options.idleTimeoutMs);
    }

    async function start() {
      await consumer.connect();
      await consumer.subscribe({ topic: options.topic, fromBeginning: false });

      await admin.connect();
      const offsets = await admin.fetchTopicOffsetsByTimestamp(options.topic, startFromMs);
      await admin.disconnect();

      consumer.on(consumer.events.GROUP_JOIN, () => {
        for (const { partition, offset } of offsets) {
          consumer.seek({ topic: options.topic, partition, offset });
        }
      });

      resetIdleTimer();

      await consumer.run({
        eachMessage: async ({ message }: { message: { value: Buffer | null } }) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(message.value?.toString('utf8') ?? '');
          } catch {
            return;
          }
          if (typeof parsed !== 'object' || parsed === null) {
            return;
          }
          const record = parsed as Record<string, unknown>;
          const correlatorValue = record[options.correlatorField];
          if (
            correlatorValue === undefined ||
            correlatorValue === null ||
            String(correlatorValue) !== options.transId
          ) {
            return;
          }

          messages.push(parsed);
          const status = record[options.statusField];
          if (typeof status === 'string') {
            receivedStatuses.add(status);
            if (options.terminalStatuses.includes(status)) {
              finish('terminal-status');
              return;
            }
          }
          resetIdleTimer();
        },
      });
    }

    start().catch((err) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(idleTimer);
      consumer
        .disconnect()
        .catch(() => {})
        .finally(() => reject(err));
    });
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test -- kafka-message-collector.test.ts`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Full workspace verification**

Run, from the repo root:
```bash
pnpm test
pnpm typecheck
```
Expected: all packages green (confirming this new module doesn't collide with or break anything in the existing, untouched Kafka Check Tracking code), zero typecheck errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/kafka-message-collector.ts packages/server/test/kafka-message-collector.test.ts
git commit -m "feat(server): add collectKafkaMessages, an ephemeral per-call Kafka consumer for test verification"
```

- [ ] **Step 7: Note on manual/real-broker verification**

There is no Docker in this environment, so real seek-by-timestamp/group-isolation behavior against an actual broker cannot be verified here (confirmed and accepted during brainstorming). If real-broker confidence is wanted later, that would be a follow-up increment (e.g. adding Testcontainers-based integration tests) run on a machine that has Docker — not a blocker for this task, which is fully covered by the mocked unit tests above.
