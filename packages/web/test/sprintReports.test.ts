import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchSprintReport, refreshSprintReport, saveSprintReport } from '../src/sprintReports';
import type { SprintReport } from '../src/sprintReports';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchSprintReport', () => {
  it('returns the parsed report on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ sprintCode: '26.08.B' }) })
    );
    expect(await fetchSprintReport('26.08.B')).toEqual({ sprintCode: '26.08.B' });
  });

  it('returns undefined when the response is not ok (e.g. 404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await fetchSprintReport('missing')).toBeUndefined();
  });

  it('returns undefined when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchSprintReport('26.08.B')).toBeUndefined();
  });
});

describe('refreshSprintReport', () => {
  it('POSTs the refresh params and returns the parsed report', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ sprintCode: '26.08.B' }) });
    vi.stubGlobal('fetch', fetchMock);

    const report = await refreshSprintReport('26.08.B', {
      startDate: '2026/08/06',
      endDate: '2026/08/19',
      labels: ['nhuvth'],
    });

    expect(fetchMock).toHaveBeenCalledWith('/sprint-reports/26.08.B/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: '2026/08/06', endDate: '2026/08/19', labels: ['nhuvth'] }),
    });
    expect(report).toEqual({ sprintCode: '26.08.B' });
  });

  it('throws with the server error message when the response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ error: 'Jira is not configured' }),
      })
    );
    await expect(
      refreshSprintReport('26.08.B', { startDate: '2026/08/06', endDate: '2026/08/19', labels: [] })
    ).rejects.toThrow('Jira is not configured');
  });
});

describe('saveSprintReport', () => {
  it('PUTs the report and returns the saved result', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ sprintCode: '26.08.B' }) });
    vi.stubGlobal('fetch', fetchMock);

    const report = { sprintCode: '26.08.B', rows: [] } as unknown as SprintReport;
    await saveSprintReport(report);

    expect(fetchMock).toHaveBeenCalledWith('/sprint-reports/26.08.B', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
  });

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    await expect(saveSprintReport({ sprintCode: '26.08.B' } as unknown as SprintReport)).rejects.toThrow();
  });
});
