import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import type { KafkaConfig } from '../src/kafka-config.js';

const mocks = vi.hoisted(() => {
  return { runKafkaContractCheck: vi.fn() };
});

vi.mock('../src/kafka-contract-check-runner.js', () => ({
  runKafkaContractCheck: mocks.runKafkaContractCheck,
}));

let dir: string | undefined;

afterEach(async () => {
  vi.clearAllMocks();
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

const KAFKA_CONFIG: KafkaConfig = {
  groupID: 'test-group',
  topics: {
    transLogV1: { brokers: ['broker:9092'], topic: 'ZPReportTransLogQC' },
    refundLog: { brokers: ['broker:9092'], topic: 'ZPReportTransLog' },
    paymentAuth: { brokers: ['broker:9092'], topic: 'payment_authentication_auth_session_status_qc' },
  },
};

async function buildTestApp(kafkaConfig?: KafkaConfig) {
  dir = await mkdtemp(join(tmpdir(), 'kafka-contract-checks-routes-'));
  return buildApp({ dataDir: dir, kafkaConfig });
}

describe('GET /kafka-contract-checks', () => {
  it('returns an empty list when nothing has been registered yet', async () => {
    const app = await buildTestApp(KAFKA_CONFIG);
    const res = await app.inject({ method: 'GET', url: '/kafka-contract-checks' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('POST /kafka-contract-checks', () => {
  it('creates a pending row, returns it with 201, and starts the runner when Kafka is configured', async () => {
    mocks.runKafkaContractCheck.mockResolvedValue(undefined);
    const app = await buildTestApp(KAFKA_CONFIG);
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-contract-checks',
      payload: { message_id: 'tx-1', name: 'Create Payment', topic: 'transLogV1', version: '1.0.0' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      message_id: 'tx-1',
      name: 'Create Payment',
      topic: 'transLogV1',
      version: '1.0.0',
      status: 'pending',
      diffReport: null,
      errorMessage: null,
    });
    expect(typeof body.created_at).toBe('string');
    expect(mocks.runKafkaContractCheck).toHaveBeenCalledWith(
      expect.objectContaining({ message_id: 'tx-1', version: '1.0.0' }),
      KAFKA_CONFIG,
      expect.stringContaining('kafka-baselines'),
      expect.anything()
    );
  });

  it('rejects with 503 and creates no row when Kafka is not configured', async () => {
    const app = await buildTestApp(undefined);
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-contract-checks',
      payload: { message_id: 'tx-1', name: 'Create Payment', topic: 'transLogV1', version: '1.0.0' },
    });
    expect(res.statusCode).toBe(503);
    expect(mocks.runKafkaContractCheck).not.toHaveBeenCalled();
    const list = await app.inject({ method: 'GET', url: '/kafka-contract-checks' });
    expect(list.json()).toEqual([]);
  });

  it('rejects a blank message_id with 400', async () => {
    const app = await buildTestApp(KAFKA_CONFIG);
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-contract-checks',
      payload: { message_id: '  ', name: 'x', topic: 'transLogV1', version: '1.0.0' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a blank name with 400', async () => {
    const app = await buildTestApp(KAFKA_CONFIG);
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-contract-checks',
      payload: { message_id: 'tx-1', name: '  ', topic: 'transLogV1', version: '1.0.0' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown topic with 400', async () => {
    const app = await buildTestApp(KAFKA_CONFIG);
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-contract-checks',
      payload: { message_id: 'tx-1', name: 'x', topic: 'disburseLog', version: '1.0.0' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a blank version with 400', async () => {
    const app = await buildTestApp(KAFKA_CONFIG);
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-contract-checks',
      payload: { message_id: 'tx-1', name: 'x', topic: 'transLogV1', version: '  ' },
    });
    expect(res.statusCode).toBe(400);
  });
});
