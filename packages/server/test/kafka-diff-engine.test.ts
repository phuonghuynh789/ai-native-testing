import { describe, it, expect } from 'vitest';
import { diffKafkaMessages } from '../src/kafka-diff-engine.js';

function transLog(overrides: Record<string, unknown>) {
  return {
    logType: 1,
    data: {
      transID: 1,
      appID: 2553,
      appTransID: 'tx-abc',
      amount: 10000,
      status: 'SUCCESS',
      updDate: '2026-01-01T00:00:00Z',
      ...overrides,
    },
  };
}

function paymentAuth(overrides: Record<string, unknown>) {
  return {
    order_no: 'order-1',
    payment_no: 'pay-1',
    status: 'PROCESSING',
    ...overrides,
  };
}

describe('diffKafkaMessages', () => {
  it('returns passed with no findings when baseline and actual are identical', () => {
    const messages = [transLog({})];
    const report = diffKafkaMessages(messages, messages, 'transLogV1');
    expect(report).toEqual({ result: 'passed', findings: [] });
  });

  it('reports a critical missing-message finding when a baseline status never appears in actual', () => {
    const baseline = [transLog({ status: 'PENDING' }), transLog({ status: 'SUCCESS' })];
    const actual = [transLog({ status: 'SUCCESS' })];
    const report = diffKafkaMessages(baseline, actual, 'transLogV1');
    expect(report.result).toBe('failed');
    expect(report.findings).toContainEqual(
      expect.objectContaining({ kind: 'missing-message', status: 'PENDING', severity: 'critical' })
    );
  });

  it('reports an info extra-message finding when actual has a status not in baseline, without failing the report', () => {
    const baseline = [transLog({ status: 'SUCCESS' })];
    const actual = [transLog({ status: 'SUCCESS' }), transLog({ status: 'FAILED' })];
    const report = diffKafkaMessages(baseline, actual, 'transLogV1');
    expect(report.result).toBe('passed');
    expect(report.findings).toContainEqual(
      expect.objectContaining({ kind: 'extra-message', status: 'FAILED', severity: 'info' })
    );
  });

  it('reports a critical missing-field finding when a matched actual message drops a field', () => {
    const baseline = [transLog({})];
    const actual = [
      {
        logType: 1,
        data: {
          transID: 1,
          appID: 2553,
          appTransID: 'tx-abc',
          status: 'SUCCESS',
          updDate: '2026-01-01T00:00:00Z',
        },
      },
    ];
    const report = diffKafkaMessages(baseline, actual, 'transLogV1');
    expect(report.result).toBe('failed');
    expect(report.findings).toContainEqual(
      expect.objectContaining({ kind: 'missing-field', status: 'SUCCESS', field: 'amount', severity: 'critical', baselineValue: 10000 })
    );
  });

  it('reports an info extra-field finding when a matched actual message has a field baseline lacks', () => {
    const baseline = [transLog({})];
    const actual = [transLog({ note: 'added later' })];
    const report = diffKafkaMessages(baseline, actual, 'transLogV1');
    expect(report.result).toBe('passed');
    expect(report.findings).toContainEqual(
      expect.objectContaining({ kind: 'extra-field', status: 'SUCCESS', field: 'note', severity: 'info', actualValue: 'added later' })
    );
  });

  it('reports a warning changed-field finding when a matched field value differs, without failing the report', () => {
    const baseline = [transLog({ amount: 10000 })];
    const actual = [transLog({ amount: 20000 })];
    const report = diffKafkaMessages(baseline, actual, 'transLogV1');
    expect(report.result).toBe('passed');
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        kind: 'changed-field',
        status: 'SUCCESS',
        field: 'amount',
        severity: 'warning',
        baselineValue: 10000,
        actualValue: 20000,
      })
    );
  });

  it('does not report a finding for fields ending in "time" or "date", case-insensitively', () => {
    const baseline = [transLog({ updDate: '2026-01-01T00:00:00Z', appTime: 1000 })];
    const actual = [transLog({ updDate: '2026-02-02T00:00:00Z', appTime: 2000 })];
    const report = diffKafkaMessages(baseline, actual, 'transLogV1');
    expect(report).toEqual({ result: 'passed', findings: [] });
  });

  it('does not report a finding for the topic correlator fields even when they differ across runs', () => {
    const baseline = [transLog({ transID: 111, appTransID: 'tx-111' })];
    const actual = [transLog({ transID: 222, appTransID: 'tx-222' })];
    const report = diffKafkaMessages(baseline, actual, 'transLogV1');
    expect(report).toEqual({ result: 'passed', findings: [] });
  });

  it('uses only the first occurrence of a duplicated status on either side', () => {
    const baseline = [transLog({ amount: 10000 }), transLog({ amount: 99999 })];
    const actual = [transLog({ amount: 10000 })];
    const report = diffKafkaMessages(baseline, actual, 'transLogV1');
    expect(report).toEqual({ result: 'passed', findings: [] });
  });

  it('fails the report when a critical finding exists alongside warning/info findings', () => {
    const baseline = [transLog({ status: 'PENDING' }), transLog({ status: 'SUCCESS', amount: 10000 })];
    const actual = [transLog({ status: 'SUCCESS', amount: 20000, note: 'x' })];
    const report = diffKafkaMessages(baseline, actual, 'transLogV1');
    expect(report.result).toBe('failed');
    expect(report.findings.map((f) => f.kind).sort()).toEqual(['changed-field', 'extra-field', 'missing-message']);
  });

  it('works for paymentAuth, a flat (non-wrapped) topic', () => {
    const baseline = [paymentAuth({})];
    const actual = [paymentAuth({ order_no: 'order-2' })];
    const report = diffKafkaMessages(baseline, actual, 'paymentAuth');
    expect(report).toEqual({ result: 'passed', findings: [] });
  });
});
