import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractCorrelatorValue, registerKafkaCheck, fetchKafkaChecks } from '../src/kafkaChecks';
import type { FormState } from '../src/types';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function sampleForm(overrides: Partial<FormState> = {}): FormState {
  return {
    actorName: '',
    taskName: 'Create Payment',
    variables: [],
    protocol: 'rest',
    method: 'POST',
    url: 'https://api.example.com/x',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    grpc: {
      protoContent: '',
      protoFilename: '',
      serverAddress: '',
      service: '',
      method: '',
      requestMessage: '',
      metadata: [],
      secure: true,
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

describe('extractCorrelatorValue', () => {
  it('reads appTransID out of the REST body for transLogV1', () => {
    const form = sampleForm({ body: '{"appTransID":"tx-123"}' });
    expect(extractCorrelatorValue(form, 'transLogV1')).toBe('tx-123');
  });

  it('reads order_no out of the REST body for paymentAuth', () => {
    const form = sampleForm({ body: '{"order_no":"order-1"}' });
    expect(extractCorrelatorValue(form, 'paymentAuth')).toBe('order-1');
  });

  it('reads the correlator out of the gRPC message when protocol is grpc', () => {
    const form = sampleForm({
      protocol: 'grpc',
      grpc: { ...sampleForm().grpc, requestMessage: '{"appTransID":"tx-grpc"}' },
    });
    expect(extractCorrelatorValue(form, 'transLogV1')).toBe('tx-grpc');
  });

  it('returns undefined when the field is missing', () => {
    const form = sampleForm({ body: '{"other":"x"}' });
    expect(extractCorrelatorValue(form, 'transLogV1')).toBeUndefined();
  });

  it('returns undefined for an empty body', () => {
    const form = sampleForm({ body: '' });
    expect(extractCorrelatorValue(form, 'transLogV1')).toBeUndefined();
  });

  it('returns undefined for malformed JSON', () => {
    const form = sampleForm({ body: '{not json' });
    expect(extractCorrelatorValue(form, 'transLogV1')).toBeUndefined();
  });
});

describe('registerKafkaCheck', () => {
  it('POSTs the message_id, name, and topic', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);

    await registerKafkaCheck({ message_id: 'tx-1', name: 'Create Payment', topic: 'transLogV1' });

    expect(fetchMock).toHaveBeenCalledWith('/kafka-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: 'tx-1', name: 'Create Payment', topic: 'transLogV1' }),
    });
  });

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    await expect(
      registerKafkaCheck({ message_id: 'tx-1', name: 'x', topic: 'transLogV1' })
    ).rejects.toThrow();
  });
});

describe('fetchKafkaChecks', () => {
  it('returns the parsed list on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([{ message_id: 'tx-1' }]) }));
    expect(await fetchKafkaChecks()).toEqual([{ message_id: 'tx-1' }]);
  });

  it('returns an empty array when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve([]) }));
    expect(await fetchKafkaChecks()).toEqual([]);
  });

  it('returns an empty array when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchKafkaChecks()).toEqual([]);
  });
});
