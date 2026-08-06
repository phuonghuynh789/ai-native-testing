import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KafkaCheckStore, type KafkaCheckRow } from '../src/kafka-check-store.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kafka-check-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function sampleRow(overrides: Partial<KafkaCheckRow> = {}): KafkaCheckRow {
  return {
    message_id: 'tx-1',
    name: 'Create Payment',
    topic: 'transLogV1',
    status: 'pending',
    missingFields: [],
    matchedMessage: null,
    created_at: '2026-08-05T00:00:00.000Z',
    updated_at: '2026-08-05T00:00:00.000Z',
    retry_count: 0,
    ...overrides,
  };
}

describe('KafkaCheckStore', () => {
  it('returns an empty list and creates the file when it does not exist yet', async () => {
    const store = new KafkaCheckStore(join(dir, 'kafka-checks.json'));
    expect(await store.list()).toEqual([]);
    const contents = await readFile(join(dir, 'kafka-checks.json'), 'utf8');
    expect(JSON.parse(contents)).toEqual({});
  });

  it('creates and retrieves a row by message_id', async () => {
    const store = new KafkaCheckStore(join(dir, 'kafka-checks.json'));
    await store.create(sampleRow());
    expect(await store.get('tx-1')).toEqual(sampleRow());
  });

  it('returns undefined for an unknown message_id', async () => {
    const store = new KafkaCheckStore(join(dir, 'kafka-checks.json'));
    expect(await store.get('missing')).toBeUndefined();
  });

  it('lists rows newest-created first', async () => {
    const store = new KafkaCheckStore(join(dir, 'kafka-checks.json'));
    await store.create(sampleRow({ message_id: 'tx-1', created_at: '2026-08-05T00:00:00.000Z' }));
    await store.create(sampleRow({ message_id: 'tx-2', created_at: '2026-08-05T00:00:05.000Z' }));
    const rows = await store.list();
    expect(rows.map((r) => r.message_id)).toEqual(['tx-2', 'tx-1']);
  });

  it('update merges a patch and bumps updated_at, returning the updated row', async () => {
    const store = new KafkaCheckStore(join(dir, 'kafka-checks.json'));
    await store.create(sampleRow());
    const updated = await store.update('tx-1', { status: 'passed' });
    expect(updated?.status).toBe('passed');
    expect(updated?.updated_at).not.toBe('2026-08-05T00:00:00.000Z');
    expect(await store.get('tx-1')).toEqual(updated);
  });

  it('update returns undefined for an unknown message_id and does not create a row', async () => {
    const store = new KafkaCheckStore(join(dir, 'kafka-checks.json'));
    expect(await store.update('missing', { status: 'failed' })).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it('persists across separate store instances pointed at the same file', async () => {
    const filePath = join(dir, 'kafka-checks.json');
    const first = new KafkaCheckStore(filePath);
    await first.create(sampleRow());

    const second = new KafkaCheckStore(filePath);
    expect(await second.get('tx-1')).toEqual(sampleRow());
  });
});
