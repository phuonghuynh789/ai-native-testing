import { describe, it, expect } from 'vitest';
import { buildTestDefinition, buildFlowDefinition, HIDDEN_RESPONSE_VARIABLE } from '../src/dsl';
import type { FormState } from '../src/types';

function emptyGrpc(overrides: Partial<FormState['grpc']> = {}): FormState['grpc'] {
  return {
    protoContent: '',
    protoFilename: '',
    serverAddress: '',
    service: '',
    method: '',
    requestMessage: '',
    metadata: [],
    secure: true,
    skipCertVerification: false,
    ...overrides,
  };
}

function emptyForm(overrides: Partial<FormState> = {}): FormState {
  return {
    actorName: 'Authenticated Customer',
    taskName: 'Create Payment',
    variables: [],
    protocol: 'rest',
    method: 'GET',
    url: 'https://api.example.com',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    grpc: emptyGrpc(),
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

describe('buildFlowDefinition', () => {
  it('uses the first form as the actor and builds one task per form in order', () => {
    const definition = buildFlowDefinition([
      emptyForm({ actorName: 'Authenticated Customer', taskName: 'Check Balance' }),
      emptyForm({ actorName: 'Someone Else', taskName: 'Transfer Money' }),
    ]);
    expect(definition.actor).toEqual({ name: 'Authenticated Customer', abilities: ['rest'] });
    expect(definition.tasks.map((t) => t.name)).toEqual(['Check Balance', 'Transfer Money']);
  });

  it('merges variables from all forms, later forms overriding earlier ones on key conflict', () => {
    const definition = buildFlowDefinition([
      emptyForm({ variables: [{ id: '1', key: 'baseUrl', value: 'https://a.example.com' }] }),
      emptyForm({
        variables: [
          { id: '2', key: 'baseUrl', value: 'https://b.example.com' },
          { id: '3', key: 'orderId', value: 'order-1' },
        ],
      }),
    ]);
    expect(definition.variables).toEqual({ baseUrl: 'https://b.example.com', orderId: 'order-1' });
  });

  it('omits variables entirely when no form has any', () => {
    const definition = buildFlowDefinition([emptyForm(), emptyForm()]);
    expect(definition.variables).toBeUndefined();
  });

  it('builds the same per-task step shape as buildTestDefinition for each form', () => {
    const definition = buildFlowDefinition([
      emptyForm({
        taskName: 'Check Balance',
        extracts: [{ id: '1', source: 'jsonPath', path: '$.data.balance', rememberAs: 'balance' }],
      }),
    ]);
    expect(definition.tasks[0].steps[0].type).toBe('interaction');
    expect(definition.tasks[0].steps[1]).toEqual({
      type: 'extract',
      runner: 'rest',
      action: 'raw',
      remember: HIDDEN_RESPONSE_VARIABLE,
    });
    expect(definition.tasks[0].steps[2]).toEqual({
      type: 'extract',
      runner: 'rest',
      action: 'jsonPath',
      with: { path: '$.data.balance' },
      remember: 'balance',
    });
  });
});

describe('buildTaskSteps with protocol: grpc', () => {
  it('builds a grpc interaction step from the grpc sub-object', () => {
    const steps = buildTestDefinition(
      emptyForm({
        protocol: 'grpc',
        grpc: emptyGrpc({
          protoContent: 'syntax = "proto3";',
          serverAddress: 'localhost:50051',
          service: 'PaymentService',
          method: 'CreatePayment',
          requestMessage: '{"amount":"100"}',
          metadata: [{ id: '1', key: 'x-request-id', value: 'abc' }],
        }),
      })
    ).tasks[0].steps;
    expect(steps[0]).toEqual({
      type: 'interaction',
      runner: 'grpc',
      action: 'call',
      with: {
        proto: 'syntax = "proto3";',
        serverAddress: 'localhost:50051',
        service: 'PaymentService',
        method: 'CreatePayment',
        message: { amount: '100' },
        metadata: { 'x-request-id': 'abc' },
        secure: true,
        skipCertVerification: false,
      },
    });
    expect(steps[1]).toEqual({ type: 'extract', runner: 'grpc', action: 'raw', remember: HIDDEN_RESPONSE_VARIABLE });
  });

  it('defaults an empty requestMessage to an empty object', () => {
    const steps = buildTestDefinition(emptyForm({ protocol: 'grpc', grpc: emptyGrpc() })).tasks[0].steps;
    const interactionStep = steps[0] as unknown as { with: { message: unknown } };
    expect(interactionStep.with.message).toEqual({});
  });

  it('tags extract and question steps with the grpc runner too', () => {
    const definition = buildTestDefinition(
      emptyForm({
        protocol: 'grpc',
        grpc: emptyGrpc(),
        extracts: [{ id: '1', source: 'jsonPath', path: '$.paymentId', rememberAs: 'paymentId' }],
        questions: [{ id: '1', source: 'status', path: '', expected: '0' }],
      })
    );
    expect(definition.tasks[0].steps[2]).toMatchObject({ type: 'extract', runner: 'grpc' });
    expect(definition.tasks[0].steps[3]).toMatchObject({ type: 'question', runner: 'grpc' });
  });

  it('carries secure and skipCertVerification through to the interaction step', () => {
    const steps = buildTestDefinition(
      emptyForm({
        protocol: 'grpc',
        grpc: emptyGrpc({ secure: false, skipCertVerification: true }),
      })
    ).tasks[0].steps;
    const interactionStep = steps[0] as unknown as { with: { secure: boolean; skipCertVerification: boolean } };
    expect(interactionStep.with.secure).toBe(false);
    expect(interactionStep.with.skipCertVerification).toBe(true);
  });
});

describe('buildFlowDefinition with mixed protocols', () => {
  it('tags each task with its own form protocol runner', () => {
    const definition = buildFlowDefinition([
      emptyForm({ protocol: 'rest', taskName: 'Check Balance' }),
      emptyForm({ protocol: 'grpc', taskName: 'Transfer Money', grpc: emptyGrpc() }),
    ]);
    expect(definition.tasks[0].steps[0]).toMatchObject({ runner: 'rest' });
    expect(definition.tasks[1].steps[0]).toMatchObject({ runner: 'grpc' });
  });

  it('sets abilities to the unique set of protocols used across the flow', () => {
    const definition = buildFlowDefinition([
      emptyForm({ protocol: 'rest' }),
      emptyForm({ protocol: 'grpc', grpc: emptyGrpc() }),
    ]);
    expect(definition.actor.abilities).toEqual(['rest', 'grpc']);
  });
});
