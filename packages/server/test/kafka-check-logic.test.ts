import { describe, it, expect } from 'vitest';
import { extractCorrelatorValue, checkRequiredFields, isTimedOut } from '../src/kafka-check-logic.js';

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

describe('extractCorrelatorValue', () => {
  it('reads the correlator field out of the data wrapper for transLogV1', () => {
    expect(extractCorrelatorValue(TRANS_LOG_MESSAGE, 'transLogV1')).toBe('tx-abc');
  });

  it('reads the correlator field at the top level for paymentAuth', () => {
    expect(extractCorrelatorValue(PAYMENT_AUTH_MESSAGE, 'paymentAuth')).toBe('order-1');
  });

  it('returns undefined when the correlator field is missing', () => {
    expect(extractCorrelatorValue({ data: {} }, 'transLogV1')).toBeUndefined();
  });

  it('returns undefined when the data wrapper is missing', () => {
    expect(extractCorrelatorValue({}, 'transLogV1')).toBeUndefined();
  });

  it('returns undefined for a non-object message', () => {
    expect(extractCorrelatorValue('not json', 'transLogV1')).toBeUndefined();
  });

  it('stringifies a numeric correlator value', () => {
    expect(extractCorrelatorValue({ data: { appTransID: 12345 } }, 'transLogV1')).toBe('12345');
  });
});

describe('checkRequiredFields', () => {
  it('returns an empty array when every required field is present', () => {
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
    expect(checkRequiredFields(message, 'transLogV1')).toEqual([]);
  });

  it('lists every missing field', () => {
    expect(checkRequiredFields({ data: { transID: 1 } }, 'transLogV1')).toEqual(
      expect.arrayContaining(['appID', 'appTransID', 'status'])
    );
    expect(checkRequiredFields({ data: { transID: 1 } }, 'transLogV1')).not.toContain('transID');
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

  it('returns the full required-fields list when the message has no usable payload', () => {
    expect(checkRequiredFields({}, 'transLogV1')).toHaveLength(23);
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
