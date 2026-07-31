import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchStepNames, fetchStep, saveStep } from '../src/steps';
import type { FormState } from '../src/types';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function sampleForm(): FormState {
  return {
    actorName: 'Customer',
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
    },
    extracts: [],
    questions: [],
  };
}

describe('fetchStepNames', () => {
  it('returns the parsed list on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(['Create Payment']) })
    );
    expect(await fetchStepNames()).toEqual(['Create Payment']);
  });

  it('returns an empty array when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve([]) }));
    expect(await fetchStepNames()).toEqual([]);
  });

  it('returns an empty array when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchStepNames()).toEqual([]);
  });
});

describe('fetchStep', () => {
  it('returns the parsed form on success', async () => {
    const form = sampleForm();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(form) }));
    expect(await fetchStep('Create Payment')).toEqual(form);
  });

  it('returns undefined when the response is not ok (e.g. 404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await fetchStep('Missing')).toBeUndefined();
  });

  it('returns undefined when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchStep('Create Payment')).toBeUndefined();
  });
});

describe('saveStep', () => {
  it('POSTs the name and form content, returning the updated names list', async () => {
    const form = sampleForm();
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ names: ['Create Payment'] }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await saveStep('Create Payment', form);

    expect(fetchMock).toHaveBeenCalledWith('/steps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Create Payment', content: form }),
    });
    expect(result).toEqual(['Create Payment']);
  });

  it('returns undefined when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await saveStep('Create Payment', sampleForm())).toBeUndefined();
  });

  it('returns undefined when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await saveStep('Create Payment', sampleForm())).toBeUndefined();
  });
});
