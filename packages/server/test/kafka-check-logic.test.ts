import { describe, it, expect } from 'vitest';
import { extractCorrelatorValues, checkRequiredFields, isTimedOut } from '../src/kafka-check-logic.js';
import { getTransLogRequiredFields } from '../src/translog-required-fields.js';

const TRANS_LOG_MESSAGE = {
  logType: 1,
  data: {
    transID: 1,
    appID: 2553,
    appTransID: 'tx-abc',
    amount: 10000,
    status: 'SUCCESS',
  },
};

const PAYMENT_AUTH_MESSAGE = {
  order_no: 'order-1',
  payment_no: 'pay-1',
  status: 'PROCESSING',
};

describe('extractCorrelatorValues', () => {
  it('reads both candidate correlator fields out of the data wrapper for transLogV1, in field order', () => {
    expect(extractCorrelatorValues(TRANS_LOG_MESSAGE, 'transLogV1')).toEqual(['tx-abc', '1']);
  });

  it('reads the sole correlator field at the top level for paymentAuth', () => {
    expect(extractCorrelatorValues(PAYMENT_AUTH_MESSAGE, 'paymentAuth')).toEqual(['order-1']);
  });

  it('returns only the fields actually present when one candidate is missing', () => {
    expect(extractCorrelatorValues({ data: { transID: 1 } }, 'transLogV1')).toEqual(['1']);
    expect(extractCorrelatorValues({ data: { appTransID: 'tx-abc' } }, 'transLogV1')).toEqual(['tx-abc']);
  });

  it('returns an empty array when no candidate fields are present', () => {
    expect(extractCorrelatorValues({ data: {} }, 'transLogV1')).toEqual([]);
  });

  it('returns an empty array when the data wrapper is missing', () => {
    expect(extractCorrelatorValues({}, 'transLogV1')).toEqual([]);
  });

  it('returns an empty array for a non-object message', () => {
    expect(extractCorrelatorValues('not json', 'transLogV1')).toEqual([]);
  });

  it('stringifies numeric correlator values', () => {
    expect(extractCorrelatorValues({ data: { appTransID: 12345, transID: 67890 } }, 'transLogV1')).toEqual([
      '12345',
      '67890',
    ]);
  });
});

describe('checkRequiredFields', () => {
  it('returns an empty array for transLogV1 when every common field is present', () => {
    const commonFields = getTransLogRequiredFields(undefined);
    const message = { data: Object.fromEntries(commonFields.map((field) => [field, 'x'])) };
    expect(checkRequiredFields(message, 'transLogV1')).toEqual([]);
  });

  it('lists every missing field for transLogV1', () => {
    expect(checkRequiredFields({ data: { transID: 1 } }, 'transLogV1')).toEqual(
      expect.arrayContaining(['appID', 'appTransID', 'status'])
    );
    expect(checkRequiredFields({ data: { transID: 1 } }, 'transLogV1')).not.toContain('transID');
  });

  it('includes status-specific fields on top of common fields when the message status matches a known schema', () => {
    const commonFields = getTransLogRequiredFields(undefined);
    const successFields = getTransLogRequiredFields('SUCCESS');
    expect(successFields).toEqual(expect.arrayContaining(commonFields));
  });

  it('treats an empty-string value as present', () => {
    expect(checkRequiredFields({ data: { transID: '' } }, 'transLogV1')).not.toContain('transID');
  });

  it('checks a nested object field as present without expanding it', () => {
    expect(
      checkRequiredFields({ data: { additionalTransInfo: { payment_method: 'WBL' } } }, 'refundLog')
    ).not.toContain('additionalTransInfo');
  });

  it('checks fields at the top level for paymentAuth (no data wrapper)', () => {
    const missing = checkRequiredFields({ order_no: 'o1' }, 'paymentAuth');
    expect(missing).toContain('payment_no');
    expect(missing).not.toContain('order_no');
  });

  it('returns the full common-fields list for transLogV1 when the message has no usable payload', () => {
    expect(checkRequiredFields({}, 'transLogV1')).toEqual(getTransLogRequiredFields(undefined));
  });
});

describe('isTimedOut', () => {
  it('is false for a pending row within the timeout window', () => {
    const row = { status: 'pending', created_at: new Date(1000).toISOString() };
    expect(isTimedOut(row, 1000 + 30_000, 60_000)).toBe(false);
  });

  it('is true for a pending row past the timeout window', () => {
    const row = { status: 'pending', created_at: new Date(1000).toISOString() };
    expect(isTimedOut(row, 1000 + 60_001, 60_000)).toBe(true);
  });

  it('is false for a non-pending row regardless of age', () => {
    const row = { status: 'passed', created_at: new Date(1000).toISOString() };
    expect(isTimedOut(row, 1000 + 999_999, 60_000)).toBe(false);
  });
});
