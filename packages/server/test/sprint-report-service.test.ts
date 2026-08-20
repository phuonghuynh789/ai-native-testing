import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshSprintReport } from '../src/sprint-report-service.js';
import { SprintReportStore } from '../src/sprint-report-store.js';
import type { JiraConfig } from '../src/jira-config.js';
import type { JiraIssue } from '../src/jira-client.js';

const mocks = vi.hoisted(() => {
  return { searchJiraIssues: vi.fn(), fetchIssueTextForKeywordCheck: vi.fn() };
});

vi.mock('../src/jira-client.js', () => ({
  searchJiraIssues: mocks.searchJiraIssues,
  fetchIssueTextForKeywordCheck: mocks.fetchIssueTextForKeywordCheck,
}));

const JIRA_CONFIG: JiraConfig = { baseUrl: 'https://jira.example.com', token: 'test-token' };

let dir: string;
let store: SprintReportStore;

function issue(key: string, project: string, overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    key,
    project,
    summary: '',
    status: 'Open',
    priority: null,
    labels: [],
    storyPoints: 3,
    productDomain: null,
    bugEnvironments: [],
    sandboxDate: null,
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  dir = await mkdtemp(join(tmpdir(), 'sprint-report-service-'));
  store = new SprintReportStore(join(dir, 'sprint-reports.json'));
  mocks.fetchIssueTextForKeywordCheck.mockResolvedValue('');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('refreshSprintReport', () => {
  it('groups issues into all 5 rows and computes delivery/quality/impact-analysis per row', async () => {
    mocks.searchJiraIssues.mockImplementation((_config: JiraConfig, jql: string) => {
      if (jql.startsWith('reporter != jira-webhook-bot') && !jql.includes('status not in')) {
        return Promise.resolve([issue('PC-1', 'PC'), issue('OP-1', 'PCPOP', { productDomain: 'Merchant Platform' })]);
      }
      if (jql.startsWith('status changed to Done')) {
        return Promise.resolve([issue('PC-1', 'PC')]);
      }
      if (jql.startsWith('status changed to "Ready for Testing"')) {
        return Promise.resolve([issue('PC-2', 'PC')]);
      }
      return Promise.resolve([]);
    });

    const report = await refreshSprintReport(JIRA_CONFIG, store, '26.08.B', {
      startDate: '2026/08/06',
      endDate: '2026/08/19',
      labels: ['nhuvth'],
    });

    const pcRow = report.rows.find((r) => r.rowKey === 'PC')!;
    expect(pcRow.delivery.committedTickets).toBe(1);
    expect(pcRow.delivery.deliveredTickets).toBe(1);
    expect(pcRow.delivery.readyForTestTickets).toBe(1);

    const mpRow = report.rows.find((r) => r.rowKey === 'PCPOP_MP')!;
    expect(mpRow.delivery.committedTickets).toBe(1);
  });

  it('preserves manual fields (checklist, iaWrongScope, executive summary, comment) from a previously saved report', async () => {
    mocks.searchJiraIssues.mockResolvedValue([]);
    const first = await refreshSprintReport(JIRA_CONFIG, store, '26.08.B', {
      startDate: '2026/08/06',
      endDate: '2026/08/19',
      labels: [],
    });
    first.rows[0].qualityChecklist.noCriticalBug = 'pass';
    first.rows[0].iaWrongScope = 2;
    first.deliveryComment = 'manual notes';
    await store.save(first);

    const second = await refreshSprintReport(JIRA_CONFIG, store, '26.08.B', {
      startDate: '2026/08/06',
      endDate: '2026/08/19',
      labels: [],
    });

    expect(second.rows[0].qualityChecklist.noCriticalBug).toBe('pass');
    expect(second.rows[0].iaWrongScope).toBe(2);
    expect(second.deliveryComment).toBe('manual notes');
  });

  it('computes sandboxDateBreakdown fresh from the committed set on every refresh, using the report end date', async () => {
    mocks.searchJiraIssues.mockImplementation((_config: JiraConfig, jql: string) => {
      if (jql.startsWith('reporter != jira-webhook-bot') && !jql.includes('status not in')) {
        return Promise.resolve([issue('PC-1', 'PC', { status: 'Ready for Testing', sandboxDate: '2026-08-19' })]);
      }
      return Promise.resolve([]);
    });

    const first = await refreshSprintReport(JIRA_CONFIG, store, '26.08.B', {
      startDate: '2026/08/06',
      endDate: '2026/08/19',
      labels: [],
    });
    const pcRow = first.rows.find((r) => r.rowKey === 'PC')!;
    expect(pcRow.sandboxDateBreakdown.readyOrInTestTickets).toBe(1);
    expect(pcRow.sandboxDateBreakdown.sandboxDateEqualsSprintEnd).toBe(1);
    await store.save(first);

    mocks.searchJiraIssues.mockImplementation((_config: JiraConfig, jql: string) => {
      if (jql.startsWith('reporter != jira-webhook-bot') && !jql.includes('status not in')) {
        return Promise.resolve([issue('PC-1', 'PC', { status: 'Ready for Testing', sandboxDate: '2026-08-20' })]);
      }
      return Promise.resolve([]);
    });

    const second = await refreshSprintReport(JIRA_CONFIG, store, '26.08.B', {
      startDate: '2026/08/06',
      endDate: '2026/08/19',
      labels: [],
    });
    const secondPcRow = second.rows.find((r) => r.rowKey === 'PC')!;
    expect(secondPcRow.sandboxDateBreakdown.sandboxDateEqualsSprintEnd).toBe(0);
    expect(secondPcRow.sandboxDateBreakdown.sandboxDatePlus1).toBe(1);
  });

  it('checks each Ready-for-Test issue for the IA keyword and tallies IA Good/Missing', async () => {
    mocks.searchJiraIssues.mockImplementation((_config: JiraConfig, jql: string) => {
      if (jql.startsWith('status changed to "Ready for Testing"')) {
        return Promise.resolve([issue('PC-1', 'PC'), issue('PC-2', 'PC')]);
      }
      return Promise.resolve([]);
    });
    mocks.fetchIssueTextForKeywordCheck.mockImplementation((_config: JiraConfig, key: string) =>
      Promise.resolve(key === 'PC-1' ? 'See IA notes' : 'Nothing relevant here')
    );

    const report = await refreshSprintReport(JIRA_CONFIG, store, '26.08.B', {
      startDate: '2026/08/06',
      endDate: '2026/08/19',
      labels: [],
    });

    const pcRow = report.rows.find((r) => r.rowKey === 'PC')!;
    expect(pcRow.impactAnalysis).toEqual({ totalTickets: 2, iaGood: 1, iaMissingInfo: 1 });
    expect(pcRow.missingImpact).toEqual([{ ticket: 'PC-2', missingInfo: '' }]);
  });

  it('queries New Tickets/SP separately from Committed and computes predictabilityNew', async () => {
    mocks.searchJiraIssues.mockImplementation((_config: JiraConfig, jql: string) => {
      if (jql.includes('status not in')) {
        return Promise.resolve([issue('PC-1', 'PC', { storyPoints: 2 })]);
      }
      if (jql.startsWith('reporter != jira-webhook-bot')) {
        return Promise.resolve([issue('PC-1', 'PC', { storyPoints: 2 }), issue('PC-2', 'PC', { storyPoints: 6 })]);
      }
      return Promise.resolve([]);
    });

    const report = await refreshSprintReport(JIRA_CONFIG, store, '26.08.B', {
      startDate: '2026/08/06',
      endDate: '2026/08/19',
      labels: [],
    });

    const pcRow = report.rows.find((r) => r.rowKey === 'PC')!;
    expect(pcRow.delivery.committedTickets).toBe(2);
    expect(pcRow.delivery.committedSP).toBe(8);
    expect(pcRow.delivery.newTickets).toBe(1);
    expect(pcRow.delivery.newSP).toBe(2);
    expect(pcRow.delivery.predictabilityNew).toBe(2 / 8);
  });

  it('builds Jira issue-search links per row for both Delivery Summary and Quality Report metrics', async () => {
    mocks.searchJiraIssues.mockResolvedValue([]);

    const report = await refreshSprintReport(JIRA_CONFIG, store, '26.08.B', {
      startDate: '2026/08/06',
      endDate: '2026/08/19',
      labels: [],
    });

    const pcRow = report.rows.find((r) => r.rowKey === 'PC')!;
    for (const url of Object.values(pcRow.deliveryJiraLinks)) {
      expect(url).toContain(`${JIRA_CONFIG.baseUrl}/issues/?jql=`);
      expect(decodeURIComponent(url.split('?jql=')[1])).toContain('project = PC');
    }
    for (const url of Object.values(pcRow.qualityJiraLinks)) {
      expect(url).toContain(`${JIRA_CONFIG.baseUrl}/issues/?jql=`);
      expect(decodeURIComponent(url.split('?jql=')[1])).toContain('project = PC');
    }

    const mpRow = report.rows.find((r) => r.rowKey === 'PCPOP_MP')!;
    const mpCommittedJql = decodeURIComponent(mpRow.deliveryJiraLinks.committed.split('?jql=')[1]);
    expect(mpCommittedJql).toContain('"Product Domain" = "Merchant Platform"');
  });
});
