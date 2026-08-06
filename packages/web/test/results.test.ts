import { describe, it, expect } from 'vitest';
import { deriveResults } from '../src/results';
import type { ExtractRow, KeyValueRow } from '../src/types';
import type { StepResult } from '@ai-native-testing/engine';

function stepResult(overrides: Partial<StepResult>): StepResult {
  return {
    type: 'interaction',
    runner: 'rest',
    action: 'request',
    status: 'passed',
    ...overrides,
  };
}

describe('deriveResults', () => {
  it('reads the response from the hidden raw step at index 1', () => {
    const stepResults = [
      stepResult({ action: 'request' }),
      stepResult({
        type: 'extract',
        action: 'raw',
        actual: { status: 201, headers: { 'content-type': 'application/json' }, body: { ok: true } },
      }),
    ];
    const result = deriveResults([], [], {}, stepResults);
    expect(result.response).toEqual({
      status: 201,
      headers: { 'content-type': 'application/json' },
      body: { ok: true },
    });
  });

  it('returns a null response when the hidden raw step has not completed', () => {
    const result = deriveResults([], [], {}, [stepResult({ action: 'request' })]);
    expect(result.response).toBeNull();
  });

  it('maps extract rows to saved values by index, skipping the hidden step', () => {
    const extracts: ExtractRow[] = [
      { id: '1', source: 'jsonPath', path: '$.data.paymentId', rememberAs: 'paymentId' },
    ];
    const stepResults = [
      stepResult({ action: 'request' }),
      stepResult({ type: 'extract', action: 'raw', actual: { status: 201, headers: {}, body: {} } }),
      stepResult({ type: 'extract', action: 'jsonPath', actual: 'pay_123' }),
    ];
    const result = deriveResults(extracts, [], {}, stepResults);
    expect(result.savedValues).toEqual({ paymentId: 'pay_123' });
  });

  it('merges saved values over seeded variables in context', () => {
    const extracts: ExtractRow[] = [{ id: '1', source: 'status', path: '', rememberAs: 'baseUrl' }];
    const stepResults = [
      stepResult({ action: 'request' }),
      stepResult({ type: 'extract', action: 'raw', actual: { status: 200, headers: {}, body: {} } }),
      stepResult({ type: 'extract', action: 'status', actual: 200 }),
    ];
    const result = deriveResults(extracts, [], { baseUrl: 'https://seed.example.com' }, stepResults);
    expect(result.context).toEqual({ baseUrl: 200 });
  });

  it('excludes the hidden raw step from logs', () => {
    const stepResults = [
      stepResult({ action: 'request' }),
      stepResult({ type: 'extract', action: 'raw', actual: {} }),
      stepResult({ type: 'question', action: 'status', status: 'passed' }),
    ];
    const result = deriveResults([], [], {}, stepResults);
    expect(result.logs).toEqual(['interaction request → passed', 'question status → passed']);
  });

  it('includes the expected/actual values for a failed question in its log line', () => {
    const stepResults = [
      stepResult({ type: 'question', action: 'status', status: 'failed', expected: 200, actual: 404 }),
    ];
    const result = deriveResults([], [], {}, stepResults);
    expect(result.logs).toEqual(['question status → failed (expected 200, got 404)']);
  });

  it('maps afterResponse rows to saved values by index, positioned after extracts', () => {
    const extracts: ExtractRow[] = [
      { id: '1', source: 'jsonPath', path: '$.data.paymentId', rememberAs: 'paymentId' },
    ];
    const afterResponse: KeyValueRow[] = [{ id: '2', key: 'authToken', value: 'Bearer pay_123' }];
    const stepResults = [
      stepResult({ action: 'request' }),
      stepResult({ type: 'extract', action: 'raw', actual: { status: 201, headers: {}, body: {} } }),
      stepResult({ type: 'extract', action: 'jsonPath', actual: 'pay_123' }),
      stepResult({ type: 'extract', action: 'echo', actual: 'Bearer pay_123' }),
    ];
    const result = deriveResults(extracts, afterResponse, {}, stepResults);
    expect(result.savedValues).toEqual({ paymentId: 'pay_123', authToken: 'Bearer pay_123' });
  });

  it('ignores a blank-key afterResponse row when positioning subsequent rows', () => {
    const afterResponse: KeyValueRow[] = [
      { id: '1', key: '', value: 'ignored' },
      { id: '2', key: 'authToken', value: 'Bearer pay_123' },
    ];
    const stepResults = [
      stepResult({ action: 'request' }),
      stepResult({ type: 'extract', action: 'raw', actual: { status: 201, headers: {}, body: {} } }),
      stepResult({ type: 'extract', action: 'echo', actual: 'Bearer pay_123' }),
    ];
    const result = deriveResults([], afterResponse, {}, stepResults);
    expect(result.savedValues).toEqual({ authToken: 'Bearer pay_123' });
  });
});
