import { describe, it, expect } from 'vitest';
import { extractJsonPath } from '../src/json-path.js';

describe('extractJsonPath', () => {
  it('extracts a nested string field', () => {
    const body = { data: { paymentId: 'pay_123' } };
    expect(extractJsonPath(body, '$.data.paymentId')).toBe('pay_123');
  });

  it('extracts a value from an array index', () => {
    const body = { data: { items: [{ id: 'a' }, { id: 'b' }] } };
    expect(extractJsonPath(body, '$.data.items[1].id')).toBe('b');
  });

  it('throws when the path does not start with $', () => {
    expect(() => extractJsonPath({}, 'data.id')).toThrow('must start with "$"');
  });

  it('throws when an intermediate segment is missing', () => {
    const body = { data: {} };
    expect(() => extractJsonPath(body, '$.data.missing.deeper')).toThrow(/could not be resolved/);
  });

  it('throws when the final value is undefined', () => {
    const body = { data: {} };
    expect(() => extractJsonPath(body, '$.data.missing')).toThrow(/did not resolve to a value/);
  });
});
