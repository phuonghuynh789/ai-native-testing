import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCapture } from './baseline-capture-core.js';
import type { FormState } from '../src/types.js';

const mocks = vi.hoisted(() => {
  return {
    collectKafkaMessages: vi.fn(),
  };
});

vi.mock('@ai-native-testing/server/src/kafka-message-collector.js', () => ({
  collectKafkaMessages: mocks.collectKafkaMessages,
}));

vi.mock('@ai-native-testing/server/src/kafka-config.js', () => ({
  loadKafkaConfig: () => ({
    groupID: 'test-group',
    topics: {
      transLogV1: { brokers: ['broker:9092'], topic: 'ZPReportTransLogQC' },
      refundLog: { brokers: ['broker:9092'], topic: 'ZPReportTransLog' },
      paymentAuth: { brokers: ['broker:9092'], topic: 'payment_authentication_auth_session_status_qc' },
    },
  }),
}));

function minimalForm(overrides: Partial<FormState> = {}): FormState {
  return {
    actorName: '',
    taskName: 'CreateOrder',
    variables: [],
    protocol: 'grpc',
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    grpc: {
      protoContent: 'syntax = "proto3";',
      protoFilename: 'x.proto',
      serverAddress: 'localhost:1',
      service: 'Svc',
      method: 'Create',
      requestMessage: JSON.stringify({ appTransID: 'tx-1' }),
      metadata: [],
      secure: false,
      skipCertVerification: false,
    },
    extracts: [],
    questions: [],
    kafkaCheck: { enabled: false, topic: 'transLogV1' },
    kafkaContractCheck: { enabled: false, topic: 'transLogV1', version: '' },
    afterResponse: [],
    ...overrides,
  };
}

describe('runCapture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the step, starts collecting before POSTing /runs, and returns the observed terminal status', async () => {
    const callOrder: string[] = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === 'http://localhost:3000/steps/CreateOrder') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(minimalForm()) });
      }
      if (url === 'http://localhost:3000/runs' && init?.method === 'POST') {
        callOrder.push('runs-posted');
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    mocks.collectKafkaMessages.mockImplementation(() => {
      callOrder.push('collect-started');
      return Promise.resolve({
        messages: [{ data: { appTransID: 'tx-1', status: 'SUCCESS' } }],
        receivedStatuses: ['SUCCESS'],
        terminatedBy: 'terminal-status',
        durationMs: 1234,
      });
    });

    const result = await runCapture({
      serverUrl: 'http://localhost:3000',
      kafkaConfigPath: '/fake/kafka.yaml',
      stepName: 'CreateOrder',
      topic: 'transLogV1',
      idleTimeoutMs: 15_000,
      terminalStatuses: ['SUCCESS', 'FAILED', 'PENDING'],
    });

    expect(callOrder).toEqual(['collect-started', 'runs-posted']);
    expect(mocks.collectKafkaMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        brokers: ['broker:9092'],
        topic: 'ZPReportTransLogQC',
        transId: 'tx-1',
        correlatorFields: ['appTransID', 'transID'],
        hasDataWrapper: true,
        statusField: 'status',
        idleTimeoutMs: 15_000,
        terminalStatuses: ['SUCCESS', 'FAILED', 'PENDING'],
      })
    );
    expect(result).toEqual({
      status: 'SUCCESS',
      durationMs: 1234,
      messages: [{ data: { appTransID: 'tx-1', status: 'SUCCESS' } }],
    });

    vi.unstubAllGlobals();
  });

  it('throws when the capture times out without a terminal status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === 'http://localhost:3000/steps/CreateOrder') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(minimalForm()) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) });
      })
    );
    mocks.collectKafkaMessages.mockResolvedValue({
      messages: [],
      receivedStatuses: [],
      terminatedBy: 'idle-timeout',
      durationMs: 15_000,
    });

    await expect(
      runCapture({
        serverUrl: 'http://localhost:3000',
        kafkaConfigPath: '/fake/kafka.yaml',
        stepName: 'CreateOrder',
        topic: 'transLogV1',
        idleTimeoutMs: 15_000,
        terminalStatuses: ['SUCCESS', 'FAILED', 'PENDING'],
      })
    ).rejects.toThrow(/timed out/i);

    vi.unstubAllGlobals();
  });

  it('throws when the saved step cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));

    await expect(
      runCapture({
        serverUrl: 'http://localhost:3000',
        kafkaConfigPath: '/fake/kafka.yaml',
        stepName: 'Missing',
        topic: 'transLogV1',
        idleTimeoutMs: 15_000,
        terminalStatuses: ['SUCCESS'],
      })
    ).rejects.toThrow(/Missing/);

    vi.unstubAllGlobals();
  });

  it('throws when no correlator value can be extracted from the step', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(minimalForm({ grpc: { ...minimalForm().grpc, requestMessage: '{}' } })),
      })
    );

    await expect(
      runCapture({
        serverUrl: 'http://localhost:3000',
        kafkaConfigPath: '/fake/kafka.yaml',
        stepName: 'CreateOrder',
        topic: 'transLogV1',
        idleTimeoutMs: 15_000,
        terminalStatuses: ['SUCCESS'],
      })
    ).rejects.toThrow(/correlator/i);

    vi.unstubAllGlobals();
  });
});
