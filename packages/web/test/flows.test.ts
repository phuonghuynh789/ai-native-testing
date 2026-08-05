import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchFlowNames, fetchFlow, addStepToFlow, setFlow } from '../src/flows';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchFlowNames', () => {
  it('returns the parsed list on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(['Transfer money by wallet']) })
    );
    expect(await fetchFlowNames()).toEqual(['Transfer money by wallet']);
  });

  it('returns an empty array when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve([]) }));
    expect(await fetchFlowNames()).toEqual([]);
  });

  it('returns an empty array when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchFlowNames()).toEqual([]);
  });
});

describe('fetchFlow', () => {
  it('returns the parsed step names on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: () => Promise.resolve(['Check Balance', 'Transfer Money']) })
    );
    expect(await fetchFlow('Transfer money by wallet')).toEqual(['Check Balance', 'Transfer Money']);
  });

  it('returns undefined when the response is not ok (e.g. 404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await fetchFlow('Missing')).toBeUndefined();
  });

  it('returns undefined when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchFlow('Transfer money by wallet')).toBeUndefined();
  });
});

describe('addStepToFlow', () => {
  it('POSTs the flow name and step name, returning the updated flow names list', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ names: ['Transfer money by wallet'] }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await addStepToFlow('Transfer money by wallet', 'Check Balance');

    expect(fetchMock).toHaveBeenCalledWith('/flows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flowName: 'Transfer money by wallet', stepName: 'Check Balance' }),
    });
    expect(result).toEqual(['Transfer money by wallet']);
  });

  it('returns undefined when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await addStepToFlow('Transfer money by wallet', 'Check Balance')).toBeUndefined();
  });

  it('returns undefined when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await addStepToFlow('Transfer money by wallet', 'Check Balance')).toBeUndefined();
  });
});

describe('setFlow', () => {
  it('PUTs the flow name and step names, returning the updated flow names list', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ names: ['Transfer money by wallet'] }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await setFlow('Transfer money by wallet', ['Check Balance', 'Transfer Money']);

    expect(fetchMock).toHaveBeenCalledWith('/flows/Transfer%20money%20by%20wallet', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepNames: ['Check Balance', 'Transfer Money'] }),
    });
    expect(result).toEqual(['Transfer money by wallet']);
  });

  it('returns undefined when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await setFlow('Transfer money by wallet', ['Check Balance'])).toBeUndefined();
  });

  it('returns undefined when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await setFlow('Transfer money by wallet', ['Check Balance'])).toBeUndefined();
  });
});
