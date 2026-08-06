import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KafkaCheckStore, type KafkaCheckRow } from '../src/kafka-check-store.js';
import { handleIncomingMessage, sweepTimedOutChecks } from '../src/kafka-consumer.js';

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
      data: Object.fromEntries(
        [
          'transID', 'appID', 'transType', 'pmcID', 'amount', 'userChargeAmount', 'userFeeAmount',
          'transStatus', 'status', 'userID', 'appTransID', 'isFullFlow', 'authInfo', 'merchantCategoryCode',
          'productType', 'orderNo', 'paymentNo', 'paymentMethod', 'destTxnStatus', 'sourceTxnStatus',
          'destAssetType', 'destAssetData', 'sourceAssetData',
        ].map((field) => [field, 'x'])
      ),
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
