import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runKafkaContractCheck } from '../src/kafka-contract-check-runner.js';
import { KafkaContractCheckStore, type KafkaContractCheckRow } from '../src/kafka-contract-check-store.js';
import type { KafkaConfig } from '../src/kafka-config.js';

const mocks = vi.hoisted(() => {
  return { collectKafkaMessages: vi.fn() };
});

vi.mock('../src/kafka-message-collector.js', () => ({
  collectKafkaMessages: mocks.collectKafkaMessages,
}));

let dir: string;
let baselinesDir: string;
let store: KafkaContractCheckStore;

const KAFKA_CONFIG: KafkaConfig = {
  groupID: 'test-group',
  topics: {
    transLogV1: { brokers: ['broker:9092'], topic: 'ZPReportTransLogQC' },
    refundLog: { brokers: ['broker:9092'], topic: 'ZPReportTransLog' },
    paymentAuth: { brokers: ['broker:9092'], topic: 'payment_authentication_auth_session_status_qc' },
  },
};

function sampleRow(overrides: Partial<KafkaContractCheckRow> = {}): KafkaContractCheckRow {
  return {
    message_id: 'tx-1',
    name: 'Create Payment',
    topic: 'transLogV1',
    version: '1.0.0',
    status: 'pending',
    diffReport: null,
    errorMessage: null,
    created_at: '2026-08-13T00:00:00.000Z',
    updated_at: '2026-08-13T00:00:00.000Z',
    ...overrides,
  };
}

async function writeBaselineFixture(topic: string, version: string, status: string, messages: unknown[]) {
  const versionDir = join(baselinesDir, topic, version);
  await mkdir(versionDir, { recursive: true });
  await writeFile(join(versionDir, `${status}.json`), JSON.stringify({ messages }));
}

beforeEach(async () => {
  vi.clearAllMocks();
  dir = await mkdtemp(join(tmpdir(), 'kafka-contract-check-runner-'));
  baselinesDir = join(dir, 'kafka-baselines');
  store = new KafkaContractCheckStore(join(dir, 'kafka-contract-checks.json'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('runKafkaContractCheck', () => {
  it('resolves to passed when the diff has no critical findings', async () => {
    await store.create(sampleRow());
    await writeBaselineFixture('transLogV1', '1.0.0', 'SUCCESS', [
      { data: { appTransID: 'tx-1', transID: 1, amount: 10000, status: 'SUCCESS' } },
    ]);
    mocks.collectKafkaMessages.mockResolvedValue({
      messages: [{ data: { appTransID: 'tx-1', transID: 2, amount: 10000, status: 'SUCCESS' } }],
      receivedStatuses: ['SUCCESS'],
      terminatedBy: 'terminal-status',
      durationMs: 500,
    });

    await runKafkaContractCheck(sampleRow(), KAFKA_CONFIG, baselinesDir, store);

    const row = await store.get('tx-1');
    expect(row?.status).toBe('passed');
    expect(row?.diffReport?.result).toBe('passed');
  });

  it('resolves to failed when the diff has a critical finding', async () => {
    await store.create(sampleRow());
    await writeBaselineFixture('transLogV1', '1.0.0', 'SUCCESS', [
      { data: { appTransID: 'tx-1', transID: 1, amount: 10000, status: 'SUCCESS' } },
    ]);
    mocks.collectKafkaMessages.mockResolvedValue({
      messages: [{ data: { appTransID: 'tx-1', transID: 2, status: 'SUCCESS' } }],
      receivedStatuses: ['SUCCESS'],
      terminatedBy: 'terminal-status',
      durationMs: 500,
    });

    await runKafkaContractCheck(sampleRow(), KAFKA_CONFIG, baselinesDir, store);

    const row = await store.get('tx-1');
    expect(row?.status).toBe('failed');
    expect(row?.diffReport?.findings).toContainEqual(
      expect.objectContaining({ kind: 'missing-field', field: 'amount' })
    );
  });

  it('keeps two topics using the same version independent, never reading the wrong topic\'s baseline', async () => {
    await store.create(sampleRow({ message_id: 'tx-1', topic: 'transLogV1', version: '1' }));
    await writeBaselineFixture('transLogV1', '1', 'SUCCESS', [
      { data: { appTransID: 'tx-1', status: 'SUCCESS', amount: 10000 } },
    ]);
    await writeBaselineFixture('refundLog', '1', 'SUCCESS', [
      { data: { appTransID: 'tx-2', status: 'SUCCESS', refundAmount: 5000 } },
    ]);
    mocks.collectKafkaMessages.mockResolvedValue({
      messages: [{ data: { appTransID: 'tx-1', status: 'SUCCESS', amount: 10000 } }],
      receivedStatuses: ['SUCCESS'],
      terminatedBy: 'terminal-status',
      durationMs: 500,
    });

    await runKafkaContractCheck(
      sampleRow({ message_id: 'tx-1', topic: 'transLogV1', version: '1' }),
      KAFKA_CONFIG,
      baselinesDir,
      store
    );

    const row = await store.get('tx-1');
    expect(row?.status).toBe('passed');
  });

  it('resolves to error with a descriptive message when collection fails', async () => {
    await store.create(sampleRow());
    mocks.collectKafkaMessages.mockRejectedValue(new Error('connection timeout'));

    await runKafkaContractCheck(sampleRow(), KAFKA_CONFIG, baselinesDir, store);

    const row = await store.get('tx-1');
    expect(row?.status).toBe('error');
    expect(row?.errorMessage).toContain('connection timeout');
  });

  it('resolves to error when the collector times out without a terminal status', async () => {
    await store.create(sampleRow());
    mocks.collectKafkaMessages.mockResolvedValue({
      messages: [],
      receivedStatuses: [],
      terminatedBy: 'idle-timeout',
      durationMs: 15_000,
    });

    await runKafkaContractCheck(sampleRow(), KAFKA_CONFIG, baselinesDir, store);

    const row = await store.get('tx-1');
    expect(row?.status).toBe('error');
    expect(row?.errorMessage).toMatch(/timed out/i);
  });

  it('passes a startFromMs looking back 24 hours, so an already-completed transaction can still be found', async () => {
    await store.create(sampleRow());
    mocks.collectKafkaMessages.mockResolvedValue({
      messages: [],
      receivedStatuses: [],
      terminatedBy: 'idle-timeout',
      durationMs: 1,
    });

    const beforeCall = Date.now();
    await runKafkaContractCheck(sampleRow(), KAFKA_CONFIG, baselinesDir, store);

    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
    const callArgs = mocks.collectKafkaMessages.mock.calls[0][0];
    expect(callArgs.startFromMs).toBeLessThanOrEqual(beforeCall - TWENTY_FOUR_HOURS_MS);
    expect(callArgs.startFromMs).toBeGreaterThan(beforeCall - TWENTY_FOUR_HOURS_MS - 5000);
  });

  it('passes the topic config\'s ssl/sasl settings through to collectKafkaMessages', async () => {
    const configWithAuth: KafkaConfig = {
      ...KAFKA_CONFIG,
      topics: {
        ...KAFKA_CONFIG.topics,
        refundLog: {
          brokers: ['broker:9092'],
          topic: 'ZPReportTransLog',
          ssl: true,
          sasl: { mechanism: 'plain', username: 'qa-user', password: 'qa-pass' },
        },
      },
    };
    await store.create(sampleRow({ topic: 'refundLog' }));
    mocks.collectKafkaMessages.mockResolvedValue({
      messages: [],
      receivedStatuses: [],
      terminatedBy: 'idle-timeout',
      durationMs: 1,
    });

    await runKafkaContractCheck(sampleRow({ topic: 'refundLog' }), configWithAuth, baselinesDir, store);

    const callArgs = mocks.collectKafkaMessages.mock.calls[0][0];
    expect(callArgs.ssl).toBe(true);
    expect(callArgs.sasl).toEqual({ mechanism: 'plain', username: 'qa-user', password: 'qa-pass' });
  });

  it('resolves to error when no baseline file exists for the version/status', async () => {
    await store.create(sampleRow());
    mocks.collectKafkaMessages.mockResolvedValue({
      messages: [{ data: { appTransID: 'tx-1', status: 'SUCCESS' } }],
      receivedStatuses: ['SUCCESS'],
      terminatedBy: 'terminal-status',
      durationMs: 500,
    });

    await runKafkaContractCheck(sampleRow(), KAFKA_CONFIG, baselinesDir, store);

    const row = await store.get('tx-1');
    expect(row?.status).toBe('error');
    expect(row?.errorMessage).toContain('No baseline found');
  });
});
