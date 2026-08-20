import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchJiraIssues, fetchIssueTextForKeywordCheck } from '../src/jira-client.js';
import type { JiraConfig } from '../src/jira-config.js';

const CONFIG: JiraConfig = { baseUrl: 'https://jira.example.com', token: 'test-token' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const FIELD_LIST = [
  { id: 'customfield_10001', name: 'Story Points' },
  { id: 'customfield_10002', name: 'Product Domain' },
  { id: 'customfield_10003', name: 'Bug in Environments:' },
  { id: 'customfield_10004', name: 'Sandbox Date' },
];

function jiraIssueJson(overrides: Record<string, unknown> = {}) {
  const { key, ...fieldOverrides } = overrides;
  return {
    key: typeof key === 'string' ? key : 'PC-1',
    fields: {
      project: { key: 'PC' },
      summary: 'Test issue',
      status: { name: 'Done' },
      priority: { name: 'High' },
      labels: ['nhuvth'],
      customfield_10001: 5,
      customfield_10002: null,
      customfield_10003: [],
      customfield_10004: null,
      ...fieldOverrides,
    },
  };
}

describe('searchJiraIssues', () => {
  it('resolves custom field IDs, requests fields by ID, and normalizes issues to human-readable fields', async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (url.includes('/rest/api/2/field')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(FIELD_LIST) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ issues: [jiraIssueJson()], total: 1 }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const issues = await searchJiraIssues(CONFIG, 'project = PC');

    expect(issues).toEqual([
      {
        key: 'PC-1',
        project: 'PC',
        summary: 'Test issue',
        status: 'Done',
        priority: 'High',
        labels: ['nhuvth'],
        storyPoints: 5,
        productDomain: null,
        bugEnvironments: [],
        sandboxDate: null,
      },
    ]);
    const searchCall = fetchMock.mock.calls.find(([url]) => url.includes('/rest/api/2/search'));
    expect(searchCall![0]).toContain('customfield_10001');
    expect(searchCall![1]).toEqual({ headers: { Authorization: 'Bearer test-token' } });
  });

  it('paginates through multiple pages of results', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/rest/api/2/field')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(FIELD_LIST) });
      }
      if (url.includes('startAt=0')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ issues: [jiraIssueJson({ key: 'PC-1' })], total: 2 }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ issues: [jiraIssueJson({ key: 'PC-2' })], total: 2 }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const issues = await searchJiraIssues(CONFIG, 'project = PC');

    expect(issues.map((i) => i.key)).toEqual(['PC-1', 'PC-2']);
  });

  it('extracts productDomain from a single-select custom field object', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/rest/api/2/field')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(FIELD_LIST) });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            issues: [jiraIssueJson({ customfield_10002: { value: 'Merchant Platform' } })],
            total: 1,
          }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const issues = await searchJiraIssues(CONFIG, 'project = PCPOP');
    expect(issues[0].productDomain).toBe('Merchant Platform');
  });

  it('extracts bugEnvironments from a multi-select custom field array', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/rest/api/2/field')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(FIELD_LIST) });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            issues: [jiraIssueJson({ customfield_10003: [{ value: 'Production' }, { value: 'Staging' }] })],
            total: 1,
          }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const issues = await searchJiraIssues(CONFIG, 'type = Bug');
    expect(issues[0].bugEnvironments).toEqual(['Production', 'Staging']);
  });

  it('extracts sandboxDate as a plain date string', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/rest/api/2/field')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(FIELD_LIST) });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            issues: [jiraIssueJson({ customfield_10004: '2026-08-15' })],
            total: 1,
          }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const issues = await searchJiraIssues(CONFIG, 'project = PC');
    expect(issues[0].sandboxDate).toBe('2026-08-15');
  });

  it('throws with just the status when the failure response has no JSON body', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/rest/api/2/field')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(FIELD_LIST) });
      }
      return Promise.resolve({ ok: false, status: 400 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchJiraIssues(CONFIG, 'bad jql')).rejects.toThrow(/400/);
  });

  it("throws with Jira's own error detail when the failure response includes errorMessages", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/rest/api/2/field')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(FIELD_LIST) });
      }
      return Promise.resolve({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({ errorMessages: ["Error in the JQL Query: Expecting operator but got 'AND'."] }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchJiraIssues(CONFIG, 'bad jql')).rejects.toThrow(/Error in the JQL Query/);
  });
});

describe('fetchIssueTextForKeywordCheck', () => {
  it('combines description and comment bodies into one string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            fields: { description: 'Please see IA notes', comment: { comments: [{ body: 'Technical Impact reviewed' }] } },
          }),
      })
    );

    const text = await fetchIssueTextForKeywordCheck(CONFIG, 'PC-1');
    expect(text).toContain('Please see IA notes');
    expect(text).toContain('Technical Impact reviewed');
  });

  it('throws when the issue request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchIssueTextForKeywordCheck(CONFIG, 'PC-999')).rejects.toThrow(/404/);
  });

  it("throws with Jira's own error detail when the failure response includes errorMessages", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ errorMessages: ['Issue does not exist or you do not have permission to see it.'] }),
      })
    );
    await expect(fetchIssueTextForKeywordCheck(CONFIG, 'PC-999')).rejects.toThrow(/do not have permission/);
  });
});
