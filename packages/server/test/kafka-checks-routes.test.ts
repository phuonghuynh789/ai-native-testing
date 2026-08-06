import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';

let dir: string | undefined;

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

async function buildTestApp() {
  dir = await mkdtemp(join(tmpdir(), 'kafka-checks-routes-'));
  return buildApp({ dataDir: dir });
}

describe('GET /kafka-checks', () => {
  it('returns an empty list when nothing has been registered yet', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/kafka-checks' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('lists registered checks newest-first', async () => {
    const app = await buildTestApp();
    await app.inject({
      method: 'POST',
      url: '/kafka-checks',
      payload: { message_id: 'tx-1', name: 'First', topic: 'transLogV1' },
    });
    await app.inject({
      method: 'POST',
      url: '/kafka-checks',
      payload: { message_id: 'tx-2', name: 'Second', topic: 'refundLog' },
    });
    const res = await app.inject({ method: 'GET', url: '/kafka-checks' });
    expect(res.json().map((row: { message_id: string }) => row.message_id)).toEqual(['tx-2', 'tx-1']);
  });
});

describe('POST /kafka-checks', () => {
  it('creates a pending row and returns it with 201', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-checks',
      payload: { message_id: 'tx-1', name: 'Create Payment', topic: 'transLogV1' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      message_id: 'tx-1',
      name: 'Create Payment',
      topic: 'transLogV1',
      status: 'pending',
      missingFields: [],
      matchedMessage: null,
      retry_count: 0,
    });
    expect(typeof body.created_at).toBe('string');
  });

  it('rejects a blank message_id with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-checks',
      payload: { message_id: '  ', name: 'x', topic: 'transLogV1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a blank name with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-checks',
      payload: { message_id: 'tx-1', name: '  ', topic: 'transLogV1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown topic with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-checks',
      payload: { message_id: 'tx-1', name: 'x', topic: 'disburseLog' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('overwrites an existing row back to pending when the same message_id is registered again', async () => {
    const app = await buildTestApp();
    await app.inject({
      method: 'POST',
      url: '/kafka-checks',
      payload: { message_id: 'tx-1', name: 'First', topic: 'transLogV1' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-checks',
      payload: { message_id: 'tx-1', name: 'First retried', topic: 'transLogV1' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('First retried');
    const list = await app.inject({ method: 'GET', url: '/kafka-checks' });
    expect(list.json()).toHaveLength(1);
  });
});
