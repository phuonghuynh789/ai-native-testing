import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadKafkaConfig } from '../src/kafka-config.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kafka-config-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const SAMPLE_YAML = `
groupID: automation_local
transLogV1:
  brokers: 10.50.1.6:9092,10.50.1.7:9092
  topic: ZPReportTransLogQC
refundLog:
  brokers: 10.60.45.2:9092
  topic: ZPReportTransLog
paymentAuth:
  brokers: 10.60.45.2:9092
  topic: payment_authentication_auth_session_status_qc
  ssl: true
  sasl:
    mechanism: plain
    username: qa-user
    password: qa-pass
disburseLog:
  brokers: 10.60.45.2:9092
  topic: td-transfer-disbursement-order-status-qc
`;

describe('loadKafkaConfig', () => {
  it('parses groupID and splits comma-separated brokers into an array per topic', async () => {
    const filePath = join(dir, 'kafka.yaml');
    await writeFile(filePath, SAMPLE_YAML);

    const config = loadKafkaConfig(filePath);

    expect(config?.groupID).toBe('automation_local');
    expect(config?.topics.transLogV1).toEqual({
      brokers: ['10.50.1.6:9092', '10.50.1.7:9092'],
      topic: 'ZPReportTransLogQC',
    });
    expect(config?.topics.refundLog).toEqual({ brokers: ['10.60.45.2:9092'], topic: 'ZPReportTransLog' });
    expect(config?.topics.paymentAuth).toEqual({
      brokers: ['10.60.45.2:9092'],
      topic: 'payment_authentication_auth_session_status_qc',
      ssl: true,
      sasl: { mechanism: 'plain', username: 'qa-user', password: 'qa-pass' },
    });
  });

  it('returns undefined when the file does not exist', () => {
    expect(loadKafkaConfig(join(dir, 'missing.yaml'))).toBeUndefined();
  });
});
