import { describe, it, expect } from 'vitest';
import { buildTestDefinition, HIDDEN_RESPONSE_VARIABLE } from '../src/dsl';
import type { FormState } from '../src/types';

function emptyForm(overrides: Partial<FormState> = {}): FormState {
  return {
    actorName: 'Authenticated Customer',
    taskName: 'Create Payment',
    variables: [],
    method: 'GET',
    url: 'https://api.example.com',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    extracts: [],
    questions: [],
    ...overrides,
  };
}

describe('buildTestDefinition', () => {
  it('builds an actor with the hardcoded rest ability and the task name', () => {
    const definition = buildTestDefinition(emptyForm());
    expect(definition.actor).toEqual({ name: 'Authenticated Customer', abilities: ['rest'] });
    expect(definition.tasks[0].name).toBe('Create Payment');
  });

  it('always inserts the request step followed by a hidden raw extract step', () => {
    const definition = buildTestDefinition(emptyForm());
    const steps = definition.tasks[0].steps;
    expect(steps[0]).toEqual({
      type: 'interaction',
      runner: 'rest',
      action: 'request',
      with: { method: 'GET', url: 'https://api.example.com' },
    });
    expect(steps[1]).toEqual({
      type: 'extract',
      runner: 'rest',
      action: 'raw',
      remember: HIDDEN_RESPONSE_VARIABLE,
    });
  });

  it('omits variables from the definition when no rows have a key', () => {
    const definition = buildTestDefinition(emptyForm());
    expect(definition.variables).toBeUndefined();
  });

  it('builds variables, params, headers, and auth from key/value rows', () => {
    const definition = buildTestDefinition(
      emptyForm({
        variables: [{ id: '1', key: 'baseUrl', value: 'https://api.example.com' }],
        params: [{ id: '2', key: 'page', value: '2' }],
        headers: [{ id: '3', key: 'X-Trace', value: 'abc' }],
        auth: { type: 'bearer', token: '${accessToken}' },
      })
    );
    expect(definition.variables).toEqual({ baseUrl: 'https://api.example.com' });
    expect(definition.tasks[0].steps[0]).toEqual({
      type: 'interaction',
      runner: 'rest',
      action: 'request',
      with: {
        method: 'GET',
        url: 'https://api.example.com',
        query: { page: '2' },
        headers: { 'X-Trace': 'abc' },
        auth: { type: 'bearer', token: '${accessToken}' },
      },
    });
  });

  it('ignores key/value rows with an empty key', () => {
    const definition = buildTestDefinition(
      emptyForm({ params: [{ id: '1', key: '', value: 'ignored' }] })
    );
    const requestStep = definition.tasks[0].steps[0] as { with: Record<string, unknown> };
    expect(requestStep.with.query).toBeUndefined();
  });

  it('parses the body as JSON', () => {
    const definition = buildTestDefinition(
      emptyForm({ body: '{"orderId":"order-1","amount":10}' })
    );
    const requestStep = definition.tasks[0].steps[0] as { with: Record<string, unknown> };
    expect(requestStep.with.body).toEqual({ orderId: 'order-1', amount: 10 });
  });

  it('builds an extract row into an extract step after the hidden response step', () => {
    const definition = buildTestDefinition(
      emptyForm({
        extracts: [{ id: '1', source: 'jsonPath', path: '$.data.paymentId', rememberAs: 'paymentId' }],
      })
    );
    expect(definition.tasks[0].steps[2]).toEqual({
      type: 'extract',
      runner: 'rest',
      action: 'jsonPath',
      with: { path: '$.data.paymentId' },
      remember: 'paymentId',
    });
  });

  it('builds a question row into a question step with a parsed expected value', () => {
    const definition = buildTestDefinition(
      emptyForm({ questions: [{ id: '1', source: 'status', path: '', expected: '201' }] })
    );
    expect(definition.tasks[0].steps[2]).toEqual({
      type: 'question',
      runner: 'rest',
      action: 'status',
      expect: { equals: 201 },
    });
  });

  it('treats a non-numeric expected value as a plain string', () => {
    const definition = buildTestDefinition(
      emptyForm({
        questions: [{ id: '1', source: 'jsonPath', path: '$.data.status', expected: 'SUCCESS' }],
      })
    );
    const step = definition.tasks[0].steps[2] as { expect: { equals: unknown } };
    expect(step.expect.equals).toBe('SUCCESS');
  });
});
