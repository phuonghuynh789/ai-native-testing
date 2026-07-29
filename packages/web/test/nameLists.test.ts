import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchNames, saveName } from '../src/nameLists';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchNames', () => {
  it('returns the parsed list on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(['Customer', 'Admin']) })
    );
    expect(await fetchNames('/actors')).toEqual(['Customer', 'Admin']);
  });

  it('returns an empty array when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve([]) }));
    expect(await fetchNames('/actors')).toEqual([]);
  });

  it('returns an empty array when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchNames('/tasks')).toEqual([]);
  });
});

describe('saveName', () => {
  it('POSTs the name to the given endpoint', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ names: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    saveName('/actors', 'Customer');

    expect(fetchMock).toHaveBeenCalledWith('/actors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Customer' }),
    });
  });

  it('does not throw when the request rejects', () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(() => saveName('/tasks', 'Create Payment')).not.toThrow();
  });
});
