import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KafkaCheckStore, type KafkaCheckRow } from '../src/kafka-check-store.js';
import { handleIncomingMessage, sweepTimedOutChecks, startKafkaConsumers } from '../src/kafka-consumer.js';
import type { KafkaConfig } from '../src/kafka-config.js';
import { getTransLogRequiredFields } from '../src/translog-required-fields.js';

vi.mock('kafkajs', () => ({
  Kafka: vi.fn().mockImplementation(() => ({
    consumer: () => ({
      connect: vi.fn().mockRejectedValue(new Error('connection timeout')),
      subscribe: vi.fn(),
      run: vi.fn(),
    }),
  })),
}));

let dir: string;
let store: KafkaCheckStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kafka-consumer-'));
  store = new KafkaCheckStore(join(dir, 'kafka-checks.json'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function pendingRow(overrides: Partial<KafkaCheckRow> = {}): KafkaCheckRow {
  return {
    message_id: 'tx-1',
    name: 'Create Payment',
    topic: 'transLogV1',
    status: 'pending',
    missingFields: [],
    matchedMessage: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    retry_count: 0,
    ...overrides,
  };
}

describe('handleIncomingMessage', () => {
  it('marks a matching pending row passed when every required field is present', async () => {
    await store.create(pendingRow());
    const message = {
      data: Object.fromEntries(getTransLogRequiredFields(undefined).map((field) => [field, 'x'])),
    };
    message.data.appTransID = 'tx-1';

    await handleIncomingMessage('transLogV1', JSON.stringify(message), store);

    const row = await store.get('tx-1');
    expect(row?.status).toBe('passed');
    expect(row?.missingFields).toEqual([]);
    expect(row?.matchedMessage).toEqual(message);
  });

  it('marks a matching pending row failed with the missing fields when some are absent', async () => {
    await store.create(pendingRow());
    const message = { data: { appTransID: 'tx-1', transID: 1 } };

    await handleIncomingMessage('transLogV1', JSON.stringify(message), store);

    const row = await store.get('tx-1');
    expect(row?.status).toBe('failed');
    expect(row?.missingFields).toContain('appID');
  });

  it('ignores a message whose correlator does not match any pending row', async () => {
    await store.create(pendingRow());
    await handleIncomingMessage('transLogV1', JSON.stringify({ data: { appTransID: 'unknown' } }), store);
    expect((await store.get('tx-1'))?.status).toBe('pending');
  });

  it('resolves a pending row registered under transID when appTransID does not match any pending row', async () => {
    await store.create(pendingRow());
    const message = {
      data: Object.fromEntries(getTransLogRequiredFields(undefined).map((field) => [field, 'x'])),
    };
    message.data.appTransID = 'some-other-app-trans-id-not-registered';
    message.data.transID = 'tx-1';

    await handleIncomingMessage('transLogV1', JSON.stringify(message), store);

    const row = await store.get('tx-1');
    expect(row?.status).toBe('passed');
    expect(row?.matchedMessage).toEqual(message);
  });

  it('ignores a message when neither candidate field matches any pending row', async () => {
    await store.create(pendingRow());
    const message = { data: { appTransID: 'unknown-app-trans-id', transID: 'unknown-trans-id' } };
    await handleIncomingMessage('transLogV1', JSON.stringify(message), store);
    expect((await store.get('tx-1'))?.status).toBe('pending');
  });

  it('ignores a message for a row already resolved (does not reprocess)', async () => {
    await store.create(pendingRow({ status: 'passed' }));
    await handleIncomingMessage('transLogV1', JSON.stringify({ data: { appTransID: 'tx-1' } }), store);
    expect((await store.get('tx-1'))?.status).toBe('passed');
  });

  it('ignores a message whose topic does not match the row it would otherwise correlate to', async () => {
    await store.create(pendingRow({ topic: 'refundLog' }));
    await handleIncomingMessage('transLogV1', JSON.stringify({ data: { appTransID: 'tx-1' } }), store);
    expect((await store.get('tx-1'))?.status).toBe('pending');
  });

  it('silently ignores malformed JSON', async () => {
    await store.create(pendingRow());
    await expect(handleIncomingMessage('transLogV1', 'not json', store)).resolves.toBeUndefined();
    expect((await store.get('tx-1'))?.status).toBe('pending');
  });
});

describe('sweepTimedOutChecks', () => {
  it('marks a stale pending row failed and increments retry_count', async () => {
    await store.create(pendingRow({ created_at: new Date(Date.now() - 61_000).toISOString() }));
    await sweepTimedOutChecks(store);
    const row = await store.get('tx-1');
    expect(row?.status).toBe('failed');
    expect(row?.missingFields).toEqual(['(timeout: no message received)']);
    expect(row?.retry_count).toBe(1);
  });

  it('leaves a recent pending row untouched', async () => {
    await store.create(pendingRow({ created_at: new Date().toISOString() }));
    await sweepTimedOutChecks(store);
    expect((await store.get('tx-1'))?.status).toBe('pending');
  });

  it('leaves an already-resolved row untouched', async () => {
    await store.create(
      pendingRow({ status: 'passed', created_at: new Date(Date.now() - 61_000).toISOString() })
    );
    await sweepTimedOutChecks(store);
    expect((await store.get('tx-1'))?.status).toBe('passed');
  });
});

describe('startKafkaConsumers', () => {
  function unreachableConfig(): KafkaConfig {
    return {
      groupID: 'test',
      topics: {
        transLogV1: { brokers: ['unreachable:9092'], topic: 'a' },
        refundLog: { brokers: ['unreachable:9092'], topic: 'b' },
        paymentAuth: { brokers: ['unreachable:9092'], topic: 'c' },
      },
    };
  }

  it('resolves even when every topic fails to connect, instead of rejecting', async () => {
    await expect(startKafkaConsumers(unreachableConfig(), store)).resolves.toBeUndefined();
  });

  it('still schedules the timeout sweep when every topic fails to connect', async () => {
    vi.useFakeTimers();
    try {
      const listSpy = vi.spyOn(store, 'list');

      await startKafkaConsumers(unreachableConfig(), store);
      expect(listSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5_000);
      expect(listSpy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
