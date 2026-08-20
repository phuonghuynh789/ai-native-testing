import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import type { JiraConfig } from '../src/jira-config.js';

const mocks = vi.hoisted(() => {
  return { refreshSprintReport: vi.fn() };
});

vi.mock('../src/sprint-report-service.js', () => ({
  refreshSprintReport: mocks.refreshSprintReport,
}));

let dir: string | undefined;

afterEach(async () => {
  vi.clearAllMocks();
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

const JIRA_CONFIG: JiraConfig = { baseUrl: 'https://jira.example.com', token: 'test-token' };

async function buildTestApp(jiraConfig?: JiraConfig) {
  dir = await mkdtemp(join(tmpdir(), 'sprint-reports-routes-'));
  return buildApp({ dataDir: dir, jiraConfig });
}

describe('GET /sprint-reports/:sprintCode', () => {
  it('returns 404 when no report has been saved for that sprint code', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/sprint-reports/26.08.B' });
    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /sprint-reports/:sprintCode', () => {
  it('saves and returns the report', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/sprint-reports/26.08.B',
      payload: {
        sprintCode: '26.08.B',
        startDate: '2026/08/06',
        endDate: '2026/08/19',
        labels: [],
        rows: [],
        deliveryComment: '',
        createdAt: '',
        updatedAt: '',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sprintCode).toBe('26.08.B');

    const getRes = await app.inject({ method: 'GET', url: '/sprint-reports/26.08.B' });
    expect(getRes.statusCode).toBe(200);
  });
});

describe('POST /sprint-reports/:sprintCode/refresh', () => {
  it('rejects with 503 when Jira is not configured', async () => {
    const app = await buildTestApp(undefined);
    const res = await app.inject({
      method: 'POST',
      url: '/sprint-reports/26.08.B/refresh',
      payload: { startDate: '2026/08/06', endDate: '2026/08/19', labels: [] },
    });
    expect(res.statusCode).toBe(503);
  });

  it('rejects with 400 when startDate/endDate are missing', async () => {
    const app = await buildTestApp(JIRA_CONFIG);
    const res = await app.inject({ method: 'POST', url: '/sprint-reports/26.08.B/refresh', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('returns the refreshed report when Jira is configured', async () => {
    mocks.refreshSprintReport.mockResolvedValue({ sprintCode: '26.08.B', rows: [] });
    const app = await buildTestApp(JIRA_CONFIG);
    const res = await app.inject({
      method: 'POST',
      url: '/sprint-reports/26.08.B/refresh',
      payload: { startDate: '2026/08/06', endDate: '2026/08/19', labels: ['nhuvth'] },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.refreshSprintReport).toHaveBeenCalledWith(JIRA_CONFIG, expect.anything(), '26.08.B', {
      startDate: '2026/08/06',
      endDate: '2026/08/19',
      labels: ['nhuvth'],
    });
  });

  it('returns 502 when the Jira refresh throws', async () => {
    mocks.refreshSprintReport.mockRejectedValue(new Error('Jira search failed: HTTP 400'));
    const app = await buildTestApp(JIRA_CONFIG);
    const res = await app.inject({
      method: 'POST',
      url: '/sprint-reports/26.08.B/refresh',
      payload: { startDate: '2026/08/06', endDate: '2026/08/19', labels: [] },
    });
    expect(res.statusCode).toBe(502);
  });
});
