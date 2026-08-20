# Sprint Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Sprint Report" page that pulls real Jira data via JQL for 5 rows (PC, PCFUM, PCPOP_MP, PCPOP_UO, PCPOP_RC) and renders a 4-section report (Sprint Delivery Summary, Quality Report, Impact Analysis Review, Executive Summary), with auto-computed metrics and editable manual commentary, persisted per sprint code.

**Architecture:** The browser never talks to Jira directly. A gitignored `packages/server/config/jira.yaml` holds the base URL + Bearer token; `jira-client.ts` is the sole module that calls Jira's REST API and is mocked in every test. A service layer (`sprint-report-service.ts`) runs 4 JQL searches, groups results into 5 rows, computes auto fields, and merges with any previously-saved manual fields before returning. A `SprintReportStore` persists the full report (auto + manual) keyed by sprint code.

**Tech Stack:** TypeScript, Fastify, Vitest, React, `node:util` fetch, no new dependencies.

## Global Constraints

- Jira config lives in `packages/server/config/jira.yaml` (gitignored, mirrors `kafka.yaml`): `{ baseUrl: string, token: string }`. Sent as `Authorization: Bearer <token>`.
- Rows are exactly `['PC', 'PCFUM', 'PCPOP_MP', 'PCPOP_UO', 'PCPOP_RC']`. `PC`/`PCFUM` map directly from the issue's `project.key`. `PCPOP` issues are split by the `Product Domain` custom field: `Merchant Platform`→`PCPOP_MP`, `Customer Experience`→`PCPOP_UO`, `Reconciliation Core`→`PCPOP_RC`. A `PCPOP` issue with no recognized Product Domain value is dropped (not counted in any row). **[Updated 2026-08-20]** The real Jira value is `User Operation`, not `Customer Experience` — the row key itself (`PCPOP_UO`, renamed from the originally-planned `PCPOP_CE`) was already right, only the domain string it matches against was wrong. The Task 4/5 code blocks below still show `Customer Experience` as originally executed; treat `User Operation` as the corrected, current value everywhere in the real source.
- Custom fields are resolved by human-readable name via Jira's `/rest/api/2/field` endpoint (never hardcode a `customfield_NNNNN` ID) for exactly 3 names: `Story Points`, `Product Domain`, `Bug in Environments:`.
- Priority → severity: `Highest`→critical, `High`/`Medium`→major, `Low`/`Lowest`→minor, anything else→null (not counted in any severity bucket, but still counted in `totalBugs`).
- Prod Bug: the `Bug in Environments:` field's resolved values include `Production`.
- Impact Analysis keyword check: case-insensitive standalone-word match for `IA` (via `/\bia\b/i`, not a plain substring — a plain substring would false-positive on ordinary words like "material") OR a case-insensitive substring match for `technical impact` or `impact analysis`.
- The 4 JQL queries are exact strings (see Task 3) — Delivered/Ready-for-Test include `type in (Task, Story)` and `labels in (...)` to match Committed's scope (confirmed explicitly, not the literal JQL originally pasted). Bugs deliberately has no labels filter.
- Auto-computed fields: Committed/Delivered/Ready-for-Test Tickets & SP, Predictability %, Total/Critical/Major/Minor/Prod Bug counts, IA Good/Missing counts, Root Cause table's `Ticket` column (prefilled: committed-but-not-delivered), Missing Impact Examples table's `Ticket` column (prefilled: IA-missing tickets).
- Manual fields (never auto-computed, always preserved across a refresh): Quality Rating checklist (4 tri-state items + assessment), IA Wrong Scope count, Root Cause table's Reason/Owner/Action, Missing Impact Examples table's Missing Info, all 4 Executive Summary indicator pickers + commentary per row, and the section-level "Nhận xét" delivery comment.
- `POST /sprint-reports/:sprintCode/refresh` never persists — it returns a merged (fresh auto + preserved manual) report. Only `PUT /sprint-reports/:sprintCode` persists.
- New route `/sprint-reports` must be added to `packages/web/vite.config.ts`'s dev proxy.
- Frontend types (`SprintReport`, `SprintReportRowData`, `RowKey`, `ROW_KEYS`) are imported from the server package via deep file imports (`@ai-native-testing/server/src/sprint-report-store.js`, `.../sprint-report-rows.js`) — never the bare `@ai-native-testing/server` specifier, which boots a real server on import.

---

### Task 1: Jira config loader

**Files:**
- Create: `packages/server/src/jira-config.ts`
- Test: `packages/server/test/jira-config.test.ts`
- Modify: `.gitignore` (add `packages/server/config/jira.yaml`)
- Create: `packages/server/config/jira.yaml.example`

**Interfaces:**
- Produces: `JiraConfig { baseUrl: string; token: string }`, `loadJiraConfig(filePath: string): JiraConfig | undefined` — every later server task depends on this exact shape.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/jira-config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadJiraConfig } from '../src/jira-config.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jira-config-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadJiraConfig', () => {
  it('parses baseUrl and token from yaml', async () => {
    const filePath = join(dir, 'jira.yaml');
    await writeFile(filePath, 'baseUrl: https://jira.zalopay.vn\ntoken: my-token\n');
    const config = loadJiraConfig(filePath);
    expect(config).toEqual({ baseUrl: 'https://jira.zalopay.vn', token: 'my-token' });
  });

  it('returns undefined when the file does not exist', () => {
    expect(loadJiraConfig(join(dir, 'missing.yaml'))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/server test -- jira-config.test.ts`
Expected: FAIL — module `../src/jira-config.js` does not exist.

- [ ] **Step 3: Implement the config loader**

Create `packages/server/src/jira-config.ts`:

```ts
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

export interface JiraConfig {
  baseUrl: string;
  token: string;
}

interface RawJiraYaml {
  baseUrl: string;
  token: string;
}

export function loadJiraConfig(filePath: string): JiraConfig | undefined {
  let contents: string;
  try {
    contents = readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
  const raw = load(contents) as RawJiraYaml;
  return { baseUrl: raw.baseUrl, token: raw.token };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/server test -- jira-config.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Add jira.yaml to .gitignore and create the example file**

Modify `.gitignore`, adding a line right after the existing `packages/server/config/kafka.yaml` entry:

```
packages/server/config/jira.yaml
```

Create `packages/server/config/jira.yaml.example`:

```yaml
baseUrl: https://jira.zalopay.vn
token: <personal access token>
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/jira-config.ts packages/server/test/jira-config.test.ts packages/server/config/jira.yaml.example .gitignore
git commit -m "feat(server): add Jira config loader"
```

---

### Task 2: Jira client

**Files:**
- Create: `packages/server/src/jira-client.ts`
- Test: `packages/server/test/jira-client.test.ts`

**Interfaces:**
- Consumes: `JiraConfig` from `./jira-config.js` (Task 1).
- Produces: `JiraIssue { key, project, summary, status, priority, labels, storyPoints, productDomain, bugEnvironments }`, `searchJiraIssues(config: JiraConfig, jql: string): Promise<JiraIssue[]>`, `fetchIssueTextForKeywordCheck(config: JiraConfig, issueKey: string): Promise<string>` — every later task that touches Jira data depends on this exact `JiraIssue` shape.

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/jira-client.test.ts`:

```ts
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
];

function jiraIssueJson(overrides: Record<string, unknown> = {}) {
  return {
    key: 'PC-1',
    fields: {
      project: { key: 'PC' },
      summary: 'Test issue',
      status: { name: 'Done' },
      priority: { name: 'High' },
      labels: ['nhuvth'],
      customfield_10001: 5,
      customfield_10002: null,
      customfield_10003: [],
      ...overrides,
    },
  };
}

describe('searchJiraIssues', () => {
  it('resolves custom field IDs, requests fields by ID, and normalizes issues to human-readable fields', async () => {
    const fetchMock = vi.fn((url: string) => {
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

  it('throws when the search request fails', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/rest/api/2/field')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(FIELD_LIST) });
      }
      return Promise.resolve({ ok: false, status: 400 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchJiraIssues(CONFIG, 'bad jql')).rejects.toThrow(/400/);
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test -- jira-client.test.ts`
Expected: FAIL — module `../src/jira-client.js` does not exist.

- [ ] **Step 3: Implement the Jira client**

Create `packages/server/src/jira-client.ts`:

```ts
import type { JiraConfig } from './jira-config.js';

export interface JiraIssue {
  key: string;
  project: string;
  summary: string;
  status: string;
  priority: string | null;
  labels: string[];
  storyPoints: number | null;
  productDomain: string | null;
  bugEnvironments: string[];
}

const STANDARD_FIELDS = ['project', 'summary', 'status', 'priority', 'labels'];
const CUSTOM_FIELD_NAMES = ['Story Points', 'Product Domain', 'Bug in Environments:'];

interface RawJiraField {
  id: string;
  name: string;
}

interface RawJiraIssue {
  key: string;
  fields: Record<string, unknown>;
}

function authHeaders(config: JiraConfig): { Authorization: string } {
  return { Authorization: `Bearer ${config.token}` };
}

async function fetchCustomFieldIds(config: JiraConfig): Promise<Record<string, string>> {
  const response = await fetch(`${config.baseUrl}/rest/api/2/field`, { headers: authHeaders(config) });
  if (!response.ok) {
    throw new Error(`Could not fetch Jira field list: HTTP ${response.status}`);
  }
  const fields = (await response.json()) as RawJiraField[];
  const map: Record<string, string> = {};
  for (const name of CUSTOM_FIELD_NAMES) {
    const match = fields.find((field) => field.name === name);
    if (match) {
      map[name] = match.id;
    }
  }
  return map;
}

function extractSingleSelectValue(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === 'string') {
    return raw;
  }
  if (typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
    return String((raw as Record<string, unknown>).value);
  }
  return null;
}

function extractMultiSelectValues(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => (typeof item === 'string' ? item : (item as Record<string, unknown> | null)?.value))
    .filter((value): value is string => typeof value === 'string');
}

function toJiraIssue(raw: RawJiraIssue, customFieldIds: Record<string, string>): JiraIssue {
  const fields = raw.fields;
  const project = fields.project as { key?: string } | undefined;
  const status = fields.status as { name?: string } | undefined;
  const priority = fields.priority as { name?: string } | undefined;
  const storyPointsId = customFieldIds['Story Points'];
  const productDomainId = customFieldIds['Product Domain'];
  const bugEnvId = customFieldIds['Bug in Environments:'];
  const storyPointsValue = storyPointsId ? fields[storyPointsId] : undefined;

  return {
    key: raw.key,
    project: project?.key ?? '',
    summary: typeof fields.summary === 'string' ? fields.summary : '',
    status: status?.name ?? '',
    priority: priority?.name ?? null,
    labels: Array.isArray(fields.labels) ? (fields.labels as string[]) : [],
    storyPoints: typeof storyPointsValue === 'number' ? storyPointsValue : null,
    productDomain: productDomainId ? extractSingleSelectValue(fields[productDomainId]) : null,
    bugEnvironments: bugEnvId ? extractMultiSelectValues(fields[bugEnvId]) : [],
  };
}

export async function searchJiraIssues(config: JiraConfig, jql: string): Promise<JiraIssue[]> {
  const customFieldIds = await fetchCustomFieldIds(config);
  const fieldParam = [...STANDARD_FIELDS, ...Object.values(customFieldIds)].join(',');

  const issues: JiraIssue[] = [];
  let startAt = 0;
  const maxResults = 100;

  while (true) {
    const url = `${config.baseUrl}/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${fieldParam}&startAt=${startAt}&maxResults=${maxResults}`;
    const response = await fetch(url, { headers: authHeaders(config) });
    if (!response.ok) {
      throw new Error(`Jira search failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as { issues: RawJiraIssue[]; total: number };
    for (const raw of body.issues) {
      issues.push(toJiraIssue(raw, customFieldIds));
    }
    startAt += body.issues.length;
    if (body.issues.length === 0 || startAt >= body.total) {
      break;
    }
  }

  return issues;
}

export async function fetchIssueTextForKeywordCheck(config: JiraConfig, issueKey: string): Promise<string> {
  const response = await fetch(`${config.baseUrl}/rest/api/2/issue/${issueKey}?fields=description,comment`, {
    headers: authHeaders(config),
  });
  if (!response.ok) {
    throw new Error(`Could not fetch issue ${issueKey}: HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    fields?: { description?: string; comment?: { comments?: Array<{ body?: string }> } };
  };
  const description = typeof body.fields?.description === 'string' ? body.fields.description : '';
  const comments = (body.fields?.comment?.comments ?? [])
    .map((comment) => (typeof comment.body === 'string' ? comment.body : ''))
    .join('\n');
  return `${description}\n${comments}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test -- jira-client.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/jira-client.ts packages/server/test/jira-client.test.ts
git commit -m "feat(server): add Jira REST API client with custom-field-name resolution"
```

---

### Task 3: JQL builders

**Files:**
- Create: `packages/server/src/sprint-report-jql.ts`
- Test: `packages/server/test/sprint-report-jql.test.ts`

**Interfaces:**
- Produces: `nextDay(dateYYYYMMDD: string): string`, `JqlDateParams { start, end, labels }`, `buildCommittedJql`, `buildDeliveredJql`, `buildReadyForTestJql`, `buildBugsJql(params: Pick<JqlDateParams, 'start' | 'end'>)` — Task 7 depends on these exact function names and signatures.

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/sprint-report-jql.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  nextDay,
  buildCommittedJql,
  buildDeliveredJql,
  buildReadyForTestJql,
  buildBugsJql,
} from '../src/sprint-report-jql.js';

describe('nextDay', () => {
  it('adds one day within the same month', () => {
    expect(nextDay('2026/08/19')).toBe('2026/08/20');
  });

  it('rolls over to the next month', () => {
    expect(nextDay('2026/08/31')).toBe('2026/09/01');
  });

  it('rolls over to the next year', () => {
    expect(nextDay('2026/12/31')).toBe('2027/01/01');
  });
});

describe('buildCommittedJql', () => {
  it('builds the exact committed JQL', () => {
    const jql = buildCommittedJql({ start: '2026/08/06', end: '2026/08/19', labels: ['nhuvth', 'minh2'] });
    expect(jql).toBe(
      'project in (PC, PCFUM, PCPOP) AND created >= "2026/08/06" AND created <= "2026/08/19" ' +
        'AND type in (Task, Story) AND type != Bug AND reporter != jira-webhook-bot ' +
        'AND status != Cancelled AND labels in (nhuvth, minh2)'
    );
  });
});

describe('buildDeliveredJql', () => {
  it('builds the exact delivered JQL, computing endPlusOne', () => {
    const jql = buildDeliveredJql({ start: '2026/08/06', end: '2026/08/19', labels: ['nhuvth'] });
    expect(jql).toBe(
      'status changed to Done during ("2026/08/06", "2026/08/19") ' +
        'AND NOT status changed to Done during ("2026/08/20", "2027/12/31") ' +
        'AND statusCategory = Done AND status in (Done, Live) ' +
        'AND project in (PC, PCFUM, PCPOP) AND type in (Task, Story) AND labels in (nhuvth)'
    );
  });
});

describe('buildReadyForTestJql', () => {
  it('builds the exact ready-for-test JQL', () => {
    const jql = buildReadyForTestJql({ start: '2026/08/06', end: '2026/08/19', labels: ['nhuvth'] });
    expect(jql).toBe(
      'status changed to "Ready for Testing" during ("2026/08/06", "2026/08/19") ' +
        'AND NOT status changed to "Ready for Testing" during ("2026/08/20", "2027/12/31") ' +
        'AND project in (PC, PCFUM, PCPOP) AND type in (Task, Story) AND labels in (nhuvth)'
    );
  });
});

describe('buildBugsJql', () => {
  it('builds the exact bugs JQL, with no labels filter', () => {
    const jql = buildBugsJql({ start: '2026/08/06', end: '2026/08/19' });
    expect(jql).toBe(
      'type = Bug AND created >= "2026/08/06" AND created <= "2026/08/19" ' +
        'AND NOT (reporter = automationtest_bot AND project = PQED) AND project IN (PC, PCPOP, PCFUM)'
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test -- sprint-report-jql.test.ts`
Expected: FAIL — module `../src/sprint-report-jql.js` does not exist.

- [ ] **Step 3: Implement the JQL builders**

Create `packages/server/src/sprint-report-jql.ts`:

```ts
export interface JqlDateParams {
  start: string;
  end: string;
  labels: string[];
}

export function nextDay(dateYYYYMMDD: string): string {
  const [year, month, day] = dateYYYYMMDD.split('/').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 1);
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  const nextDayOfMonth = String(date.getUTCDate()).padStart(2, '0');
  return `${nextYear}/${nextMonth}/${nextDayOfMonth}`;
}

export function buildCommittedJql(params: JqlDateParams): string {
  return (
    `project in (PC, PCFUM, PCPOP) AND created >= "${params.start}" AND created <= "${params.end}" ` +
    `AND type in (Task, Story) AND type != Bug AND reporter != jira-webhook-bot ` +
    `AND status != Cancelled AND labels in (${params.labels.join(', ')})`
  );
}

export function buildDeliveredJql(params: JqlDateParams): string {
  const endPlusOne = nextDay(params.end);
  return (
    `status changed to Done during ("${params.start}", "${params.end}") ` +
    `AND NOT status changed to Done during ("${endPlusOne}", "2027/12/31") ` +
    `AND statusCategory = Done AND status in (Done, Live) ` +
    `AND project in (PC, PCFUM, PCPOP) AND type in (Task, Story) AND labels in (${params.labels.join(', ')})`
  );
}

export function buildReadyForTestJql(params: JqlDateParams): string {
  const endPlusOne = nextDay(params.end);
  return (
    `status changed to "Ready for Testing" during ("${params.start}", "${params.end}") ` +
    `AND NOT status changed to "Ready for Testing" during ("${endPlusOne}", "2027/12/31") ` +
    `AND project in (PC, PCFUM, PCPOP) AND type in (Task, Story) AND labels in (${params.labels.join(', ')})`
  );
}

export function buildBugsJql(params: Pick<JqlDateParams, 'start' | 'end'>): string {
  return (
    `type = Bug AND created >= "${params.start}" AND created <= "${params.end}" ` +
    `AND NOT (reporter = automationtest_bot AND project = PQED) AND project IN (PC, PCPOP, PCFUM)`
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test -- sprint-report-jql.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/sprint-report-jql.ts packages/server/test/sprint-report-jql.test.ts
git commit -m "feat(server): add Sprint Report JQL builders"
```

---

### Task 4: Row grouping

**Files:**
- Create: `packages/server/src/sprint-report-rows.ts`
- Test: `packages/server/test/sprint-report-rows.test.ts`

**Interfaces:**
- Consumes: `JiraIssue` from `./jira-client.js` (Task 2).
- Produces: `ROW_KEYS: readonly ['PC', 'PCFUM', 'PCPOP_MP', 'PCPOP_UO', 'PCPOP_RC']`, `RowKey` type, `groupIssuesByRow(issues: JiraIssue[]): Record<RowKey, JiraIssue[]>` — every later task depends on these exact names.

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/sprint-report-rows.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { groupIssuesByRow } from '../src/sprint-report-rows.js';
import type { JiraIssue } from '../src/jira-client.js';

function issue(overrides: Partial<JiraIssue>): JiraIssue {
  return {
    key: 'X-1',
    project: 'PC',
    summary: '',
    status: 'Open',
    priority: null,
    labels: [],
    storyPoints: null,
    productDomain: null,
    bugEnvironments: [],
    ...overrides,
  };
}

describe('groupIssuesByRow', () => {
  it('groups PC and PCFUM issues directly by project', () => {
    const groups = groupIssuesByRow([issue({ key: 'PC-1', project: 'PC' }), issue({ key: 'FUM-1', project: 'PCFUM' })]);
    expect(groups.PC.map((i) => i.key)).toEqual(['PC-1']);
    expect(groups.PCFUM.map((i) => i.key)).toEqual(['FUM-1']);
  });

  it('splits PCPOP issues by Product Domain into three rows', () => {
    const groups = groupIssuesByRow([
      issue({ key: 'OP-1', project: 'PCPOP', productDomain: 'Merchant Platform' }),
      issue({ key: 'OP-2', project: 'PCPOP', productDomain: 'Customer Experience' }),
      issue({ key: 'OP-3', project: 'PCPOP', productDomain: 'Reconciliation Core' }),
    ]);
    expect(groups.PCPOP_MP.map((i) => i.key)).toEqual(['OP-1']);
    expect(groups.PCPOP_UO.map((i) => i.key)).toEqual(['OP-2']);
    expect(groups.PCPOP_RC.map((i) => i.key)).toEqual(['OP-3']);
  });

  it('drops a PCPOP issue with no recognized Product Domain', () => {
    const groups = groupIssuesByRow([issue({ key: 'OP-9', project: 'PCPOP', productDomain: null })]);
    expect(groups.PCPOP_MP).toEqual([]);
    expect(groups.PCPOP_UO).toEqual([]);
    expect(groups.PCPOP_RC).toEqual([]);
  });

  it('ignores an issue from an unrecognized project', () => {
    const groups = groupIssuesByRow([issue({ key: 'OTHER-1', project: 'OTHER' })]);
    expect(Object.values(groups).flat()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test -- sprint-report-rows.test.ts`
Expected: FAIL — module `../src/sprint-report-rows.js` does not exist.

- [ ] **Step 3: Implement row grouping**

Create `packages/server/src/sprint-report-rows.ts`:

```ts
import type { JiraIssue } from './jira-client.js';

export const ROW_KEYS = ['PC', 'PCFUM', 'PCPOP_MP', 'PCPOP_UO', 'PCPOP_RC'] as const;
export type RowKey = (typeof ROW_KEYS)[number];

const PRODUCT_DOMAIN_TO_ROW: Record<string, RowKey> = {
  'Merchant Platform': 'PCPOP_MP',
  'Customer Experience': 'PCPOP_UO',
  'Reconciliation Core': 'PCPOP_RC',
};

export function groupIssuesByRow(issues: JiraIssue[]): Record<RowKey, JiraIssue[]> {
  const groups: Record<RowKey, JiraIssue[]> = {
    PC: [],
    PCFUM: [],
    PCPOP_MP: [],
    PCPOP_UO: [],
    PCPOP_RC: [],
  };
  for (const issue of issues) {
    if (issue.project === 'PC') {
      groups.PC.push(issue);
    } else if (issue.project === 'PCFUM') {
      groups.PCFUM.push(issue);
    } else if (issue.project === 'PCPOP') {
      const rowKey = issue.productDomain ? PRODUCT_DOMAIN_TO_ROW[issue.productDomain] : undefined;
      if (rowKey) {
        groups[rowKey].push(issue);
      }
    }
  }
  return groups;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test -- sprint-report-rows.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/sprint-report-rows.ts packages/server/test/sprint-report-rows.test.ts
git commit -m "feat(server): add Sprint Report row grouping (PC/PCFUM/PCPOP Product Domain split)"
```

---

### Task 5: Report computation logic (delivery, quality, impact analysis)

**Files:**
- Create: `packages/server/src/sprint-report-delivery.ts`
- Create: `packages/server/src/sprint-report-quality.ts`
- Create: `packages/server/src/sprint-report-impact-analysis.ts`
- Test: `packages/server/test/sprint-report-delivery.test.ts`
- Test: `packages/server/test/sprint-report-quality.test.ts`
- Test: `packages/server/test/sprint-report-impact-analysis.test.ts`

**Interfaces:**
- Consumes: `JiraIssue` from `./jira-client.js` (Task 2).
- Produces: `DeliveryRow`, `RootCauseRow`, `computeDeliveryRow`, `prefillRootCauseTable`; `QualityRow`, `mapPriorityToSeverity`, `isProdBug`, `computeQualityRow`; `ImpactAnalysisRow`, `MissingImpactRow`, `hasImpactAnalysisKeyword`, `computeImpactAnalysisRow`, `prefillMissingImpactTable` — Tasks 6 and 7 depend on these exact names and shapes.

- [ ] **Step 1: Write the failing delivery tests**

Create `packages/server/test/sprint-report-delivery.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeDeliveryRow, prefillRootCauseTable } from '../src/sprint-report-delivery.js';
import type { JiraIssue } from '../src/jira-client.js';

function issue(key: string, storyPoints: number | null): JiraIssue {
  return {
    key,
    project: 'PC',
    summary: '',
    status: 'Open',
    priority: null,
    labels: [],
    storyPoints,
    productDomain: null,
    bugEnvironments: [],
  };
}

describe('computeDeliveryRow', () => {
  it('sums story points and counts tickets per query', () => {
    const row = computeDeliveryRow(
      [issue('A', 5), issue('B', 3)],
      [issue('A', 5)],
      [issue('A', 5), issue('C', 2)]
    );
    expect(row).toEqual({
      committedTickets: 2,
      committedSP: 8,
      deliveredTickets: 1,
      deliveredSP: 5,
      readyForTestTickets: 2,
      readyForTestSP: 7,
      predictability: 5 / 8,
    });
  });

  it('treats a missing Story Points value as 0', () => {
    const row = computeDeliveryRow([issue('A', null)], [], []);
    expect(row.committedSP).toBe(0);
  });

  it('returns null predictability when committed SP is 0', () => {
    const row = computeDeliveryRow([], [], []);
    expect(row.predictability).toBeNull();
  });
});

describe('prefillRootCauseTable', () => {
  it('lists committed tickets that are not yet delivered, with blank manual fields', () => {
    const rows = prefillRootCauseTable([issue('A', 5), issue('B', 3)], [issue('A', 5)]);
    expect(rows).toEqual([{ ticket: 'B', reason: '', owner: '', action: '' }]);
  });

  it('returns an empty list when every committed ticket was delivered', () => {
    const rows = prefillRootCauseTable([issue('A', 5)], [issue('A', 5)]);
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run delivery test to verify it fails**

Run: `pnpm --filter @ai-native-testing/server test -- sprint-report-delivery.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement delivery computation**

Create `packages/server/src/sprint-report-delivery.ts`:

```ts
import type { JiraIssue } from './jira-client.js';

export interface DeliveryRow {
  committedTickets: number;
  committedSP: number;
  deliveredTickets: number;
  deliveredSP: number;
  readyForTestTickets: number;
  readyForTestSP: number;
  predictability: number | null;
}

export interface RootCauseRow {
  ticket: string;
  reason: string;
  owner: string;
  action: string;
}

function sumStoryPoints(issues: JiraIssue[]): number {
  return issues.reduce((sum, issue) => sum + (issue.storyPoints ?? 0), 0);
}

export function computeDeliveryRow(
  committed: JiraIssue[],
  delivered: JiraIssue[],
  readyForTest: JiraIssue[]
): DeliveryRow {
  const committedSP = sumStoryPoints(committed);
  const deliveredSP = sumStoryPoints(delivered);
  return {
    committedTickets: committed.length,
    committedSP,
    deliveredTickets: delivered.length,
    deliveredSP,
    readyForTestTickets: readyForTest.length,
    readyForTestSP: sumStoryPoints(readyForTest),
    predictability: committedSP > 0 ? deliveredSP / committedSP : null,
  };
}

export function prefillRootCauseTable(committed: JiraIssue[], delivered: JiraIssue[]): RootCauseRow[] {
  const deliveredKeys = new Set(delivered.map((issue) => issue.key));
  return committed
    .filter((issue) => !deliveredKeys.has(issue.key))
    .map((issue) => ({ ticket: issue.key, reason: '', owner: '', action: '' }));
}
```

- [ ] **Step 4: Run delivery test to verify it passes**

Run: `pnpm --filter @ai-native-testing/server test -- sprint-report-delivery.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing quality tests**

Create `packages/server/test/sprint-report-quality.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mapPriorityToSeverity, isProdBug, computeQualityRow } from '../src/sprint-report-quality.js';
import type { JiraIssue } from '../src/jira-client.js';

function bug(priority: string | null, bugEnvironments: string[] = []): JiraIssue {
  return {
    key: 'BUG-1',
    project: 'PC',
    summary: '',
    status: 'Open',
    priority,
    labels: [],
    storyPoints: null,
    productDomain: null,
    bugEnvironments,
  };
}

describe('mapPriorityToSeverity', () => {
  it('maps Highest to critical', () => {
    expect(mapPriorityToSeverity('Highest')).toBe('critical');
  });

  it('maps High and Medium to major', () => {
    expect(mapPriorityToSeverity('High')).toBe('major');
    expect(mapPriorityToSeverity('Medium')).toBe('major');
  });

  it('maps Low and Lowest to minor', () => {
    expect(mapPriorityToSeverity('Low')).toBe('minor');
    expect(mapPriorityToSeverity('Lowest')).toBe('minor');
  });

  it('maps an unrecognized or missing priority to null', () => {
    expect(mapPriorityToSeverity('Unknown')).toBeNull();
    expect(mapPriorityToSeverity(null)).toBeNull();
  });
});

describe('isProdBug', () => {
  it('is true when Production is one of the bug environments', () => {
    expect(isProdBug(['Production', 'Staging'])).toBe(true);
  });

  it('is false when Production is absent', () => {
    expect(isProdBug(['Staging'])).toBe(false);
    expect(isProdBug([])).toBe(false);
  });
});

describe('computeQualityRow', () => {
  it('tallies severity and prod-bug counts across all bugs', () => {
    const row = computeQualityRow([
      bug('Highest', ['Production']),
      bug('High'),
      bug('Low'),
      bug('Medium', ['Production']),
    ]);
    expect(row).toEqual({ totalBugs: 4, critical: 1, major: 2, minor: 1, prodBug: 2 });
  });

  it('returns all zeros for an empty bug list', () => {
    expect(computeQualityRow([])).toEqual({ totalBugs: 0, critical: 0, major: 0, minor: 0, prodBug: 0 });
  });
});
```

- [ ] **Step 6: Run quality test to verify it fails**

Run: `pnpm --filter @ai-native-testing/server test -- sprint-report-quality.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 7: Implement quality computation**

Create `packages/server/src/sprint-report-quality.ts`:

```ts
import type { JiraIssue } from './jira-client.js';

export interface QualityRow {
  totalBugs: number;
  critical: number;
  major: number;
  minor: number;
  prodBug: number;
}

export function mapPriorityToSeverity(priority: string | null): 'critical' | 'major' | 'minor' | null {
  if (priority === 'Highest') {
    return 'critical';
  }
  if (priority === 'High' || priority === 'Medium') {
    return 'major';
  }
  if (priority === 'Low' || priority === 'Lowest') {
    return 'minor';
  }
  return null;
}

export function isProdBug(bugEnvironments: string[]): boolean {
  return bugEnvironments.includes('Production');
}

export function computeQualityRow(bugs: JiraIssue[]): QualityRow {
  let critical = 0;
  let major = 0;
  let minor = 0;
  let prodBug = 0;
  for (const bug of bugs) {
    const severity = mapPriorityToSeverity(bug.priority);
    if (severity === 'critical') {
      critical += 1;
    } else if (severity === 'major') {
      major += 1;
    } else if (severity === 'minor') {
      minor += 1;
    }
    if (isProdBug(bug.bugEnvironments)) {
      prodBug += 1;
    }
  }
  return { totalBugs: bugs.length, critical, major, minor, prodBug };
}
```

- [ ] **Step 8: Run quality test to verify it passes**

Run: `pnpm --filter @ai-native-testing/server test -- sprint-report-quality.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 9: Write the failing impact-analysis tests**

Create `packages/server/test/sprint-report-impact-analysis.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  hasImpactAnalysisKeyword,
  computeImpactAnalysisRow,
  prefillMissingImpactTable,
} from '../src/sprint-report-impact-analysis.js';
import type { JiraIssue } from '../src/jira-client.js';

function issue(key: string): JiraIssue {
  return {
    key,
    project: 'PC',
    summary: '',
    status: 'Ready for Testing',
    priority: null,
    labels: [],
    storyPoints: null,
    productDomain: null,
    bugEnvironments: [],
  };
}

describe('hasImpactAnalysisKeyword', () => {
  it('matches a standalone "IA" acronym, case-insensitively', () => {
    expect(hasImpactAnalysisKeyword('See IA notes below')).toBe(true);
    expect(hasImpactAnalysisKeyword('see ia notes below')).toBe(true);
  });

  it('does not match "ia" embedded inside an unrelated word', () => {
    expect(hasImpactAnalysisKeyword('This material change is special')).toBe(false);
  });

  it('matches the multi-word phrases "Technical Impact" and "Impact Analysis"', () => {
    expect(hasImpactAnalysisKeyword('Technical Impact: none')).toBe(true);
    expect(hasImpactAnalysisKeyword('impact analysis done')).toBe(true);
  });

  it('returns false when none of the keywords are present', () => {
    expect(hasImpactAnalysisKeyword('Just a normal description')).toBe(false);
  });
});

describe('computeImpactAnalysisRow', () => {
  it('splits results into good and missing counts', () => {
    expect(computeImpactAnalysisRow([true, false, true])).toEqual({
      totalTickets: 3,
      iaGood: 2,
      iaMissingInfo: 1,
    });
  });
});

describe('prefillMissingImpactTable', () => {
  it('lists only tickets missing the IA keyword, with blank manual info', () => {
    const rows = prefillMissingImpactTable([issue('A'), issue('B')], [true, false]);
    expect(rows).toEqual([{ ticket: 'B', missingInfo: '' }]);
  });
});
```

- [ ] **Step 10: Run impact-analysis test to verify it fails**

Run: `pnpm --filter @ai-native-testing/server test -- sprint-report-impact-analysis.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 11: Implement impact-analysis computation**

Create `packages/server/src/sprint-report-impact-analysis.ts`:

```ts
import type { JiraIssue } from './jira-client.js';

const MULTI_WORD_KEYWORDS = ['technical impact', 'impact analysis'];

export function hasImpactAnalysisKeyword(text: string): boolean {
  if (/\bia\b/i.test(text)) {
    return true;
  }
  const lower = text.toLowerCase();
  return MULTI_WORD_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export interface ImpactAnalysisRow {
  totalTickets: number;
  iaGood: number;
  iaMissingInfo: number;
}

export function computeImpactAnalysisRow(hasKeywordResults: boolean[]): ImpactAnalysisRow {
  const iaGood = hasKeywordResults.filter(Boolean).length;
  return {
    totalTickets: hasKeywordResults.length,
    iaGood,
    iaMissingInfo: hasKeywordResults.length - iaGood,
  };
}

export interface MissingImpactRow {
  ticket: string;
  missingInfo: string;
}

export function prefillMissingImpactTable(
  readyForTest: JiraIssue[],
  hasKeywordResults: boolean[]
): MissingImpactRow[] {
  const rows: MissingImpactRow[] = [];
  readyForTest.forEach((issue, index) => {
    if (!hasKeywordResults[index]) {
      rows.push({ ticket: issue.key, missingInfo: '' });
    }
  });
  return rows;
}
```

- [ ] **Step 12: Run impact-analysis test to verify it passes**

Run: `pnpm --filter @ai-native-testing/server test -- sprint-report-impact-analysis.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 13: Commit**

```bash
git add packages/server/src/sprint-report-delivery.ts packages/server/src/sprint-report-quality.ts packages/server/src/sprint-report-impact-analysis.ts packages/server/test/sprint-report-delivery.test.ts packages/server/test/sprint-report-quality.test.ts packages/server/test/sprint-report-impact-analysis.test.ts
git commit -m "feat(server): add Sprint Report computation logic (delivery, quality, impact analysis)"
```

---

### Task 6: SprintReportStore

**Files:**
- Create: `packages/server/src/sprint-report-store.ts`
- Test: `packages/server/test/sprint-report-store.test.ts`

**Interfaces:**
- Consumes: `RowKey` from `./sprint-report-rows.js` (Task 4); `DeliveryRow`, `RootCauseRow` from `./sprint-report-delivery.js`; `QualityRow` from `./sprint-report-quality.js`; `ImpactAnalysisRow`, `MissingImpactRow` from `./sprint-report-impact-analysis.js` (all Task 5).
- Produces: `TriState`, `QualityChecklist`, `ExecutiveSummaryRow`, `SprintReportRowData`, `SprintReport`, `SprintReportStore` (class with `get(sprintCode)`, `save(report)`) — Tasks 7, 8, and every frontend task depend on this exact shape.

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/sprint-report-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SprintReportStore, type SprintReport, type SprintReportRowData } from '../src/sprint-report-store.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sprint-report-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function sampleRow(rowKey: SprintReportRowData['rowKey']): SprintReportRowData {
  return {
    rowKey,
    delivery: {
      committedTickets: 0,
      committedSP: 0,
      deliveredTickets: 0,
      deliveredSP: 0,
      readyForTestTickets: 0,
      readyForTestSP: 0,
      predictability: null,
    },
    quality: { totalBugs: 0, critical: 0, major: 0, minor: 0, prodBug: 0 },
    impactAnalysis: { totalTickets: 0, iaGood: 0, iaMissingInfo: 0 },
    qualityChecklist: {
      noCriticalBug: 'unset',
      noProductionBug: 'unset',
      reopenRateUnder10: 'unset',
      uatStable: 'unset',
      assessment: 'unset',
    },
    iaWrongScope: 0,
    rootCause: [],
    missingImpact: [],
    executiveSummary: { delivery: 'unset', quality: 'unset', impactAnalysis: 'unset', overall: 'unset', commentary: '' },
  };
}

function sampleReport(overrides: Partial<SprintReport> = {}): SprintReport {
  return {
    sprintCode: '26.08.B',
    startDate: '2026/08/06',
    endDate: '2026/08/19',
    labels: ['nhuvth'],
    rows: [sampleRow('PC')],
    deliveryComment: '',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('SprintReportStore', () => {
  it('returns undefined for a sprint code that has never been saved', async () => {
    const store = new SprintReportStore(join(dir, 'sprint-reports.json'));
    expect(await store.get('26.08.B')).toBeUndefined();
  });

  it('saves and retrieves a report by sprint code', async () => {
    const store = new SprintReportStore(join(dir, 'sprint-reports.json'));
    await store.save(sampleReport());
    const loaded = await store.get('26.08.B');
    expect(loaded?.sprintCode).toBe('26.08.B');
    expect(loaded?.rows).toEqual([sampleRow('PC')]);
  });

  it('preserves the original createdAt and bumps updatedAt on a second save', async () => {
    const store = new SprintReportStore(join(dir, 'sprint-reports.json'));
    const first = await store.save(sampleReport({ createdAt: '', updatedAt: '' }));
    const second = await store.save(sampleReport({ createdAt: '', updatedAt: '', deliveryComment: 'updated' }));
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).not.toBe(first.updatedAt);
    expect(second.deliveryComment).toBe('updated');
  });

  it('persists across separate store instances pointed at the same file', async () => {
    const filePath = join(dir, 'sprint-reports.json');
    const first = new SprintReportStore(filePath);
    await first.save(sampleReport());

    const second = new SprintReportStore(filePath);
    expect((await second.get('26.08.B'))?.sprintCode).toBe('26.08.B');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test -- sprint-report-store.test.ts`
Expected: FAIL — module `../src/sprint-report-store.js` does not exist.

- [ ] **Step 3: Implement the store**

Create `packages/server/src/sprint-report-store.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RowKey } from './sprint-report-rows.js';
import type { DeliveryRow, RootCauseRow } from './sprint-report-delivery.js';
import type { QualityRow } from './sprint-report-quality.js';
import type { ImpactAnalysisRow, MissingImpactRow } from './sprint-report-impact-analysis.js';

export type TriState = 'unset' | 'pass' | 'fail';

export interface QualityChecklist {
  noCriticalBug: TriState;
  noProductionBug: TriState;
  reopenRateUnder10: TriState;
  uatStable: TriState;
  assessment: 'unset' | 'good' | 'need-improvement';
}

export interface ExecutiveSummaryRow {
  delivery: 'unset' | 'good' | 'bad';
  quality: 'unset' | 'good' | 'bad';
  impactAnalysis: 'unset' | 'good' | 'partial' | 'bad';
  overall: 'unset' | 'good' | 'medium' | 'bad';
  commentary: string;
}

export interface SprintReportRowData {
  rowKey: RowKey;
  delivery: DeliveryRow;
  quality: QualityRow;
  impactAnalysis: ImpactAnalysisRow;
  qualityChecklist: QualityChecklist;
  iaWrongScope: number;
  rootCause: RootCauseRow[];
  missingImpact: MissingImpactRow[];
  executiveSummary: ExecutiveSummaryRow;
}

export interface SprintReport {
  sprintCode: string;
  startDate: string;
  endDate: string;
  labels: string[];
  rows: SprintReportRowData[];
  deliveryComment: string;
  createdAt: string;
  updatedAt: string;
}

export class SprintReportStore {
  constructor(private readonly filePath: string) {}

  async get(sprintCode: string): Promise<SprintReport | undefined> {
    const map = await this.readMap();
    return map[sprintCode];
  }

  async save(report: SprintReport): Promise<SprintReport> {
    const map = await this.readMap();
    const now = new Date().toISOString();
    const existing = map[report.sprintCode];
    const saved: SprintReport = {
      ...report,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    map[report.sprintCode] = saved;
    await this.write(map);
    return saved;
  }

  private async readMap(): Promise<Record<string, SprintReport>> {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      return JSON.parse(contents) as Record<string, SprintReport>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.write({});
        return {};
      }
      throw err;
    }
  }

  private async write(map: Record<string, SprintReport>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(map, null, 2));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test -- sprint-report-store.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/sprint-report-store.ts packages/server/test/sprint-report-store.test.ts
git commit -m "feat(server): add SprintReportStore"
```

---

### Task 7: Sprint report service (orchestration + merge-on-refresh)

**Files:**
- Create: `packages/server/src/sprint-report-service.ts`
- Test: `packages/server/test/sprint-report-service.test.ts`

**Interfaces:**
- Consumes: `searchJiraIssues`, `fetchIssueTextForKeywordCheck` from `./jira-client.js` (Task 2); `buildCommittedJql`, `buildDeliveredJql`, `buildReadyForTestJql`, `buildBugsJql` from `./sprint-report-jql.js` (Task 3); `ROW_KEYS`, `groupIssuesByRow` from `./sprint-report-rows.js` (Task 4); `computeDeliveryRow`, `prefillRootCauseTable` from `./sprint-report-delivery.js`, `computeQualityRow` from `./sprint-report-quality.js`, `hasImpactAnalysisKeyword`, `computeImpactAnalysisRow`, `prefillMissingImpactTable` from `./sprint-report-impact-analysis.js` (Task 5); `SprintReport`, `SprintReportRowData`, `SprintReportStore` from `./sprint-report-store.js` (Task 6).
- Produces: `RefreshParams { startDate, endDate, labels }`, `refreshSprintReport(jiraConfig, store, sprintCode, params): Promise<SprintReport>` — Task 8's route depends on this exact signature.

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/sprint-report-service.test.ts`:

```ts
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
      if (jql.startsWith('project in')) {
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

  it('keeps a previously-entered root-cause reason for a ticket still awaiting delivery', async () => {
    mocks.searchJiraIssues.mockImplementation((_config: JiraConfig, jql: string) => {
      if (jql.startsWith('project in')) {
        return Promise.resolve([issue('PC-1', 'PC')]);
      }
      return Promise.resolve([]);
    });

    const first = await refreshSprintReport(JIRA_CONFIG, store, '26.08.B', {
      startDate: '2026/08/06',
      endDate: '2026/08/19',
      labels: [],
    });
    const pcRow = first.rows.find((r) => r.rowKey === 'PC')!;
    expect(pcRow.rootCause).toEqual([{ ticket: 'PC-1', reason: '', owner: '', action: '' }]);
    pcRow.rootCause[0].reason = 'blocked on infra';
    await store.save(first);

    const second = await refreshSprintReport(JIRA_CONFIG, store, '26.08.B', {
      startDate: '2026/08/06',
      endDate: '2026/08/19',
      labels: [],
    });
    const secondPcRow = second.rows.find((r) => r.rowKey === 'PC')!;
    expect(secondPcRow.rootCause).toEqual([{ ticket: 'PC-1', reason: 'blocked on infra', owner: '', action: '' }]);
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test -- sprint-report-service.test.ts`
Expected: FAIL — module `../src/sprint-report-service.js` does not exist.

- [ ] **Step 3: Implement the service**

Create `packages/server/src/sprint-report-service.ts`:

```ts
import type { JiraConfig } from './jira-config.js';
import { searchJiraIssues, fetchIssueTextForKeywordCheck } from './jira-client.js';
import { buildCommittedJql, buildDeliveredJql, buildReadyForTestJql, buildBugsJql } from './sprint-report-jql.js';
import { ROW_KEYS, groupIssuesByRow, type RowKey } from './sprint-report-rows.js';
import { computeDeliveryRow, prefillRootCauseTable } from './sprint-report-delivery.js';
import { computeQualityRow } from './sprint-report-quality.js';
import {
  hasImpactAnalysisKeyword,
  computeImpactAnalysisRow,
  prefillMissingImpactTable,
} from './sprint-report-impact-analysis.js';
import type { SprintReport, SprintReportRowData, SprintReportStore } from './sprint-report-store.js';

export interface RefreshParams {
  startDate: string;
  endDate: string;
  labels: string[];
}

function defaultRowData(rowKey: RowKey): SprintReportRowData {
  return {
    rowKey,
    delivery: {
      committedTickets: 0,
      committedSP: 0,
      deliveredTickets: 0,
      deliveredSP: 0,
      readyForTestTickets: 0,
      readyForTestSP: 0,
      predictability: null,
    },
    quality: { totalBugs: 0, critical: 0, major: 0, minor: 0, prodBug: 0 },
    impactAnalysis: { totalTickets: 0, iaGood: 0, iaMissingInfo: 0 },
    qualityChecklist: {
      noCriticalBug: 'unset',
      noProductionBug: 'unset',
      reopenRateUnder10: 'unset',
      uatStable: 'unset',
      assessment: 'unset',
    },
    iaWrongScope: 0,
    rootCause: [],
    missingImpact: [],
    executiveSummary: {
      delivery: 'unset',
      quality: 'unset',
      impactAnalysis: 'unset',
      overall: 'unset',
      commentary: '',
    },
  };
}

function mergeManualTableRows<T extends { ticket: string }>(fresh: T[], previous: T[]): T[] {
  const previousByTicket = new Map(previous.map((row) => [row.ticket, row]));
  return fresh.map((row) => previousByTicket.get(row.ticket) ?? row);
}

export async function refreshSprintReport(
  jiraConfig: JiraConfig,
  store: SprintReportStore,
  sprintCode: string,
  params: RefreshParams
): Promise<SprintReport> {
  const jqlParams = { start: params.startDate, end: params.endDate, labels: params.labels };

  const [committed, delivered, readyForTest, bugs] = await Promise.all([
    searchJiraIssues(jiraConfig, buildCommittedJql(jqlParams)),
    searchJiraIssues(jiraConfig, buildDeliveredJql(jqlParams)),
    searchJiraIssues(jiraConfig, buildReadyForTestJql(jqlParams)),
    searchJiraIssues(jiraConfig, buildBugsJql(jqlParams)),
  ]);

  const committedByRow = groupIssuesByRow(committed);
  const deliveredByRow = groupIssuesByRow(delivered);
  const readyForTestByRow = groupIssuesByRow(readyForTest);
  const bugsByRow = groupIssuesByRow(bugs);

  const previous = await store.get(sprintCode);
  const previousRows = new Map((previous?.rows ?? []).map((row) => [row.rowKey, row]));

  const rows: SprintReportRowData[] = [];
  for (const rowKey of ROW_KEYS) {
    const rowCommitted = committedByRow[rowKey];
    const rowDelivered = deliveredByRow[rowKey];
    const rowReadyForTest = readyForTestByRow[rowKey];
    const rowBugs = bugsByRow[rowKey];

    const keywordResults = await Promise.all(
      rowReadyForTest.map(async (issue) => {
        const text = await fetchIssueTextForKeywordCheck(jiraConfig, issue.key);
        return hasImpactAnalysisKeyword(text);
      })
    );

    const previousRow = previousRows.get(rowKey);
    const freshRootCause = prefillRootCauseTable(rowCommitted, rowDelivered);
    const freshMissingImpact = prefillMissingImpactTable(rowReadyForTest, keywordResults);
    const base = previousRow ?? defaultRowData(rowKey);

    rows.push({
      rowKey,
      delivery: computeDeliveryRow(rowCommitted, rowDelivered, rowReadyForTest),
      quality: computeQualityRow(rowBugs),
      impactAnalysis: computeImpactAnalysisRow(keywordResults),
      qualityChecklist: base.qualityChecklist,
      iaWrongScope: base.iaWrongScope,
      rootCause: mergeManualTableRows(freshRootCause, base.rootCause),
      missingImpact: mergeManualTableRows(freshMissingImpact, base.missingImpact),
      executiveSummary: base.executiveSummary,
    });
  }

  return {
    sprintCode,
    startDate: params.startDate,
    endDate: params.endDate,
    labels: params.labels,
    rows,
    deliveryComment: previous?.deliveryComment ?? '',
    createdAt: previous?.createdAt ?? '',
    updatedAt: previous?.updatedAt ?? '',
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test -- sprint-report-service.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/sprint-report-service.ts packages/server/test/sprint-report-service.test.ts
git commit -m "feat(server): add Sprint Report refresh service (orchestration + manual-field merge)"
```

---

### Task 8: Routes + app.ts/index.ts wiring

**Files:**
- Create: `packages/server/src/routes/sprint-reports.ts`
- Test: `packages/server/test/sprint-reports-routes.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/index.ts`

**Interfaces:**
- Consumes: `SprintReportStore`, `SprintReport` from `../sprint-report-store.js` (Task 6); `refreshSprintReport` from `../sprint-report-service.js` (Task 7); `JiraConfig` from `../jira-config.js` (Task 1).
- Produces: `registerSprintReportRoutes(app, store, jiraConfig): void`; `BuildAppOptions` gains `jiraConfig?: JiraConfig` — no later task depends on this, it completes the server side.

- [ ] **Step 1: Write the failing route tests**

Create `packages/server/test/sprint-reports-routes.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test -- sprint-reports-routes.test.ts`
Expected: FAIL — `buildApp` doesn't accept a `jiraConfig` option yet, and `/sprint-reports` routes don't exist (404s).

- [ ] **Step 3: Implement the routes**

Create `packages/server/src/routes/sprint-reports.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { JiraConfig } from '../jira-config.js';
import { refreshSprintReport } from '../sprint-report-service.js';
import type { SprintReport, SprintReportStore } from '../sprint-report-store.js';

export function registerSprintReportRoutes(
  app: FastifyInstance,
  store: SprintReportStore,
  jiraConfig: JiraConfig | undefined
): void {
  app.get('/sprint-reports/:sprintCode', async (request, reply) => {
    const { sprintCode } = request.params as { sprintCode: string };
    const report = await store.get(sprintCode);
    if (!report) {
      return reply.code(404).send({ error: 'Sprint report not found' });
    }
    return reply.send(report);
  });

  app.put('/sprint-reports/:sprintCode', async (request, reply) => {
    const { sprintCode } = request.params as { sprintCode: string };
    const body = request.body as SprintReport;
    const saved = await store.save({ ...body, sprintCode });
    return reply.send(saved);
  });

  app.post('/sprint-reports/:sprintCode/refresh', async (request, reply) => {
    const { sprintCode } = request.params as { sprintCode: string };
    const { startDate, endDate, labels } = (request.body ?? {}) as {
      startDate?: string;
      endDate?: string;
      labels?: string[];
    };
    if (!startDate || !endDate) {
      return reply.code(400).send({ error: 'startDate and endDate are required' });
    }
    if (!jiraConfig) {
      return reply.code(503).send({ error: 'Jira is not configured on this server' });
    }
    try {
      const report = await refreshSprintReport(jiraConfig, store, sprintCode, {
        startDate,
        endDate,
        labels: labels ?? [],
      });
      return reply.send(report);
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
```

- [ ] **Step 4: Wire into app.ts**

Modify `packages/server/src/app.ts`, adding to the import block:

```ts
import type { JiraConfig } from './jira-config.js';
import { SprintReportStore } from './sprint-report-store.js';
import { registerSprintReportRoutes } from './routes/sprint-reports.js';
```

Add `jiraConfig` to `BuildAppOptions`:

```ts
export interface BuildAppOptions {
  dataDir?: string;
  kafkaConfig?: KafkaConfig;
  jiraConfig?: JiraConfig;
}
```

Add wiring right before the final `return app;`:

```ts
  const sprintReportStore = new SprintReportStore(join(dataDir, 'sprint-reports.json'));
  registerSprintReportRoutes(app, sprintReportStore, options.jiraConfig);

  return app;
}
```

- [ ] **Step 5: Wire into index.ts**

Modify `packages/server/src/index.ts`, adding the import:

```ts
import { loadJiraConfig } from './jira-config.js';
```

Right after the existing `const kafkaConfig = loadKafkaConfig(kafkaConfigPath);` line, add:

```ts
const jiraConfigPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'jira.yaml');
const jiraConfig = loadJiraConfig(jiraConfigPath);
```

Change the `buildApp({ kafkaConfig })` call to:

```ts
const app = buildApp({ kafkaConfig, jiraConfig });
```

Right after the existing `if (kafkaConfig) { ... } else { ... }` block, add:

```ts
if (!jiraConfig) {
  app.log.warn('Jira config not found at config/jira.yaml — Sprint Report feature disabled');
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test -- sprint-reports-routes.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Run the full server suite and typecheck**

Run: `pnpm --filter @ai-native-testing/server test && pnpm --filter @ai-native-testing/server typecheck`
Expected: PASS — all existing tests plus the new ones.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/routes/sprint-reports.ts packages/server/test/sprint-reports-routes.test.ts packages/server/src/app.ts packages/server/src/index.ts
git commit -m "feat(server): add GET/PUT/POST /sprint-reports routes"
```

---

### Task 9: Frontend client module

**Files:**
- Create: `packages/web/src/sprintReports.ts`
- Test: `packages/web/test/sprintReports.test.ts`

**Interfaces:**
- Consumes: `SprintReport`, `SprintReportRowData` (types) from `@ai-native-testing/server/src/sprint-report-store.js`; `RowKey`, `ROW_KEYS` from `@ai-native-testing/server/src/sprint-report-rows.js` — deep file imports only, never the bare `@ai-native-testing/server` specifier.
- Produces: `fetchSprintReport(sprintCode)`, `refreshSprintReport(sprintCode, params)`, `saveSprintReport(report)` — every frontend component task depends on these.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/test/sprintReports.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- sprintReports.test.ts`
Expected: FAIL — module `../src/sprintReports` does not exist.

- [ ] **Step 3: Implement the client module**

Create `packages/web/src/sprintReports.ts`:

```ts
export type { SprintReport, SprintReportRowData } from '@ai-native-testing/server/src/sprint-report-store.js';
export type { RowKey } from '@ai-native-testing/server/src/sprint-report-rows.js';
export { ROW_KEYS } from '@ai-native-testing/server/src/sprint-report-rows.js';

import type { SprintReport } from '@ai-native-testing/server/src/sprint-report-store.js';

export async function fetchSprintReport(sprintCode: string): Promise<SprintReport | undefined> {
  try {
    const response = await fetch(`/sprint-reports/${encodeURIComponent(sprintCode)}`);
    if (!response.ok) {
      return undefined;
    }
    return (await response.json()) as SprintReport;
  } catch {
    return undefined;
  }
}

export async function refreshSprintReport(
  sprintCode: string,
  params: { startDate: string; endDate: string; labels: string[] }
): Promise<SprintReport> {
  const response = await fetch(`/sprint-reports/${encodeURIComponent(sprintCode)}/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`Could not refresh the sprint report: ${(body as { error?: string }).error ?? response.status}`);
  }
  return (await response.json()) as SprintReport;
}

export async function saveSprintReport(report: SprintReport): Promise<SprintReport> {
  const response = await fetch(`/sprint-reports/${encodeURIComponent(report.sprintCode)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
  if (!response.ok) {
    throw new Error('Could not save the sprint report.');
  }
  return (await response.json()) as SprintReport;
}
```

Note: `ROW_KEYS`/`RowKey`/`SprintReport`/`SprintReportRowData` are re-exported from `packages/web/src/sprintReports.ts` via deep imports into `@ai-native-testing/server`'s specific, side-effect-free files — never the bare package specifier, which would boot a real server on import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- sprintReports.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: PASS, no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/sprintReports.ts packages/web/test/sprintReports.test.ts
git commit -m "feat(web): add Sprint Report client module"
```

---

### Task 10: Delivery Summary + Quality Report section components

**Files:**
- Create: `packages/web/src/components/SprintDeliverySummarySection.tsx`
- Create: `packages/web/src/components/QualityReportSection.tsx`
- Test: `packages/web/test/components/SprintDeliverySummarySection.test.tsx`
- Test: `packages/web/test/components/QualityReportSection.test.tsx`

**Interfaces:**
- Consumes: `SprintReportRowData` from `../sprintReports` (Task 9).
- Produces: `SprintDeliverySummarySection` (props: `rows`, `onRowsChange`, `deliveryComment`, `onDeliveryCommentChange`), `QualityReportSection` (props: `rows`, `onRowsChange`) — Task 12 composes these.

- [ ] **Step 1: Write the failing Delivery Summary test**

Create `packages/web/test/components/SprintDeliverySummarySection.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SprintDeliverySummarySection } from '../../src/components/SprintDeliverySummarySection';
import type { SprintReportRowData } from '../../src/sprintReports';

function row(overrides: Partial<SprintReportRowData> = {}): SprintReportRowData {
  return {
    rowKey: 'PC',
    delivery: {
      committedTickets: 10,
      committedSP: 80,
      deliveredTickets: 8,
      deliveredSP: 70,
      readyForTestTickets: 9,
      readyForTestSP: 75,
      predictability: 0.875,
    },
    quality: { totalBugs: 0, critical: 0, major: 0, minor: 0, prodBug: 0 },
    impactAnalysis: { totalTickets: 0, iaGood: 0, iaMissingInfo: 0 },
    qualityChecklist: {
      noCriticalBug: 'unset',
      noProductionBug: 'unset',
      reopenRateUnder10: 'unset',
      uatStable: 'unset',
      assessment: 'unset',
    },
    iaWrongScope: 0,
    rootCause: [{ ticket: 'PC-1', reason: '', owner: '', action: '' }],
    missingImpact: [],
    executiveSummary: { delivery: 'unset', quality: 'unset', impactAnalysis: 'unset', overall: 'unset', commentary: '' },
    ...overrides,
  };
}

describe('SprintDeliverySummarySection', () => {
  it('renders committed/delivered/ready-for-test numbers and predictability as a percentage', () => {
    render(
      <SprintDeliverySummarySection
        rows={[row()]}
        onRowsChange={() => {}}
        deliveryComment=""
        onDeliveryCommentChange={() => {}}
      />
    );
    expect(screen.getByText('80')).toBeInTheDocument();
    expect(screen.getByText('70')).toBeInTheDocument();
    expect(screen.getByText('87.5%')).toBeInTheDocument();
  });

  it('shows a dash for predictability when committed SP is 0', () => {
    render(
      <SprintDeliverySummarySection
        rows={[row({ delivery: { ...row().delivery, committedSP: 0, predictability: null } })]}
        onRowsChange={() => {}}
        deliveryComment=""
        onDeliveryCommentChange={() => {}}
      />
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('calls onDeliveryCommentChange when the Nhận xét textarea changes', async () => {
    const onDeliveryCommentChange = vi.fn();
    render(
      <SprintDeliverySummarySection
        rows={[row()]}
        onRowsChange={() => {}}
        deliveryComment=""
        onDeliveryCommentChange={onDeliveryCommentChange}
      />
    );
    await userEvent.type(screen.getByLabelText('Nhận xét'), 'x');
    expect(onDeliveryCommentChange).toHaveBeenCalledWith('x');
  });

  it('calls onRowsChange with an updated reason when a root cause reason is edited', async () => {
    const onRowsChange = vi.fn();
    render(
      <SprintDeliverySummarySection
        rows={[row()]}
        onRowsChange={onRowsChange}
        deliveryComment=""
        onDeliveryCommentChange={() => {}}
      />
    );
    await userEvent.type(screen.getByLabelText('PC-1 reason'), 'x');
    const updatedRows = onRowsChange.mock.calls[0][0] as SprintReportRowData[];
    expect(updatedRows[0].rootCause[0].reason).toBe('x');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/web test -- SprintDeliverySummarySection.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement SprintDeliverySummarySection**

Create `packages/web/src/components/SprintDeliverySummarySection.tsx`:

```tsx
import type { SprintReportRowData } from '../sprintReports';

export interface SprintDeliverySummarySectionProps {
  rows: SprintReportRowData[];
  onRowsChange: (rows: SprintReportRowData[]) => void;
  deliveryComment: string;
  onDeliveryCommentChange: (comment: string) => void;
}

function updateRow(
  rows: SprintReportRowData[],
  rowKey: SprintReportRowData['rowKey'],
  patch: Partial<SprintReportRowData>
): SprintReportRowData[] {
  return rows.map((row) => (row.rowKey === rowKey ? { ...row, ...patch } : row));
}

export function SprintDeliverySummarySection({
  rows,
  onRowsChange,
  deliveryComment,
  onDeliveryCommentChange,
}: SprintDeliverySummarySectionProps) {
  return (
    <section className="card">
      <h2 className="heading-md">1. Sprint Delivery Summary</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Squad</th>
            <th>Committed Tickets</th>
            <th>Committed SP</th>
            <th>Delivered Tickets</th>
            <th>Delivered SP</th>
            <th>Predictability</th>
            <th>Ready for Test Tickets</th>
            <th>Ready for Test SP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rowKey}>
              <td>{row.rowKey}</td>
              <td>{row.delivery.committedTickets}</td>
              <td>{row.delivery.committedSP}</td>
              <td>{row.delivery.deliveredTickets}</td>
              <td>{row.delivery.deliveredSP}</td>
              <td>{row.delivery.predictability === null ? '—' : `${(row.delivery.predictability * 100).toFixed(1)}%`}</td>
              <td>{row.delivery.readyForTestTickets}</td>
              <td>{row.delivery.readyForTestSP}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <label className="label">
        Nhận xét
        <textarea
          className="text-input"
          value={deliveryComment}
          onChange={(e) => onDeliveryCommentChange(e.target.value)}
        />
      </label>

      <h3 className="heading-md">Root Cause Tickets Trễ</h3>
      {rows.map(
        (row) =>
          row.rootCause.length > 0 && (
            <div key={row.rowKey}>
              <p className="body-strong">{row.rowKey}</p>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Reason</th>
                    <th>Owner</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {row.rootCause.map((rc, index) => (
                    <tr key={rc.ticket}>
                      <td>{rc.ticket}</td>
                      <td>
                        <input
                          className="text-input"
                          aria-label={`${rc.ticket} reason`}
                          value={rc.reason}
                          onChange={(e) => {
                            const rootCause = row.rootCause.map((r, i) => (i === index ? { ...r, reason: e.target.value } : r));
                            onRowsChange(updateRow(rows, row.rowKey, { rootCause }));
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="text-input"
                          aria-label={`${rc.ticket} owner`}
                          value={rc.owner}
                          onChange={(e) => {
                            const rootCause = row.rootCause.map((r, i) => (i === index ? { ...r, owner: e.target.value } : r));
                            onRowsChange(updateRow(rows, row.rowKey, { rootCause }));
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="text-input"
                          aria-label={`${rc.ticket} action`}
                          value={rc.action}
                          onChange={(e) => {
                            const rootCause = row.rootCause.map((r, i) => (i === index ? { ...r, action: e.target.value } : r));
                            onRowsChange(updateRow(rows, row.rowKey, { rootCause }));
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/web test -- SprintDeliverySummarySection.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing Quality Report test**

Create `packages/web/test/components/QualityReportSection.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QualityReportSection } from '../../src/components/QualityReportSection';
import type { SprintReportRowData } from '../../src/sprintReports';

function row(overrides: Partial<SprintReportRowData> = {}): SprintReportRowData {
  return {
    rowKey: 'PC',
    delivery: {
      committedTickets: 0,
      committedSP: 0,
      deliveredTickets: 0,
      deliveredSP: 0,
      readyForTestTickets: 0,
      readyForTestSP: 0,
      predictability: null,
    },
    quality: { totalBugs: 25, critical: 0, major: 3, minor: 22, prodBug: 0 },
    impactAnalysis: { totalTickets: 0, iaGood: 0, iaMissingInfo: 0 },
    qualityChecklist: {
      noCriticalBug: 'unset',
      noProductionBug: 'unset',
      reopenRateUnder10: 'unset',
      uatStable: 'unset',
      assessment: 'unset',
    },
    iaWrongScope: 0,
    rootCause: [],
    missingImpact: [],
    executiveSummary: { delivery: 'unset', quality: 'unset', impactAnalysis: 'unset', overall: 'unset', commentary: '' },
    ...overrides,
  };
}

describe('QualityReportSection', () => {
  it('renders the auto-computed bug counts', () => {
    render(<QualityReportSection rows={[row()]} onRowsChange={() => {}} />);
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('22')).toBeInTheDocument();
  });

  it('calls onRowsChange when the assessment select changes', async () => {
    const onRowsChange = vi.fn();
    render(<QualityReportSection rows={[row()]} onRowsChange={onRowsChange} />);
    await userEvent.selectOptions(screen.getByLabelText('PC assessment'), 'good');
    const updatedRows = onRowsChange.mock.calls[0][0] as SprintReportRowData[];
    expect(updatedRows[0].qualityChecklist.assessment).toBe('good');
  });

  it('calls onRowsChange when a Quality Rating checklist item changes', async () => {
    const onRowsChange = vi.fn();
    render(<QualityReportSection rows={[row()]} onRowsChange={onRowsChange} />);
    await userEvent.selectOptions(screen.getByLabelText('PC noCriticalBug'), 'pass');
    const updatedRows = onRowsChange.mock.calls[0][0] as SprintReportRowData[];
    expect(updatedRows[0].qualityChecklist.noCriticalBug).toBe('pass');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/web test -- QualityReportSection.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 7: Implement QualityReportSection**

Create `packages/web/src/components/QualityReportSection.tsx`:

```tsx
import type { SprintReportRowData } from '../sprintReports';

export interface QualityReportSectionProps {
  rows: SprintReportRowData[];
  onRowsChange: (rows: SprintReportRowData[]) => void;
}

const TRI_STATE_OPTIONS = ['unset', 'pass', 'fail'] as const;
const CHECKLIST_CRITERIA = ['noCriticalBug', 'noProductionBug', 'reopenRateUnder10', 'uatStable'] as const;

function updateRow(
  rows: SprintReportRowData[],
  rowKey: SprintReportRowData['rowKey'],
  patch: Partial<SprintReportRowData>
): SprintReportRowData[] {
  return rows.map((row) => (row.rowKey === rowKey ? { ...row, ...patch } : row));
}

export function QualityReportSection({ rows, onRowsChange }: QualityReportSectionProps) {
  return (
    <section className="card">
      <h2 className="heading-md">2. Quality Report</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Squad</th>
            <th>Total Bugs</th>
            <th>Critical</th>
            <th>Major</th>
            <th>Minor</th>
            <th>Prod Bug</th>
            <th>Assessment</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rowKey}>
              <td>{row.rowKey}</td>
              <td>{row.quality.totalBugs}</td>
              <td>{row.quality.critical}</td>
              <td>{row.quality.major}</td>
              <td>{row.quality.minor}</td>
              <td>{row.quality.prodBug}</td>
              <td>
                <select
                  className="text-input"
                  aria-label={`${row.rowKey} assessment`}
                  value={row.qualityChecklist.assessment}
                  onChange={(e) =>
                    onRowsChange(
                      updateRow(rows, row.rowKey, {
                        qualityChecklist: {
                          ...row.qualityChecklist,
                          assessment: e.target.value as SprintReportRowData['qualityChecklist']['assessment'],
                        },
                      })
                    )
                  }
                >
                  <option value="unset">—</option>
                  <option value="good">Good</option>
                  <option value="need-improvement">Need Improvement</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="heading-md">Quality Rating</h3>
      {rows.map((row) => (
        <div key={row.rowKey}>
          <p className="body-strong">{row.rowKey}</p>
          {CHECKLIST_CRITERIA.map((criterion) => (
            <label className="label" key={criterion}>
              {criterion}
              <select
                className="text-input"
                aria-label={`${row.rowKey} ${criterion}`}
                value={row.qualityChecklist[criterion]}
                onChange={(e) =>
                  onRowsChange(
                    updateRow(rows, row.rowKey, {
                      qualityChecklist: { ...row.qualityChecklist, [criterion]: e.target.value },
                    })
                  )
                }
              >
                {TRI_STATE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/web test -- QualityReportSection.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 9: Run typecheck**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: PASS, no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/web/src/components/SprintDeliverySummarySection.tsx packages/web/src/components/QualityReportSection.tsx packages/web/test/components/SprintDeliverySummarySection.test.tsx packages/web/test/components/QualityReportSection.test.tsx
git commit -m "feat(web): add Sprint Delivery Summary and Quality Report section components"
```

---

### Task 11: Impact Analysis + Executive Summary section components

**Files:**
- Create: `packages/web/src/components/ImpactAnalysisSection.tsx`
- Create: `packages/web/src/components/ExecutiveSummarySection.tsx`
- Test: `packages/web/test/components/ImpactAnalysisSection.test.tsx`
- Test: `packages/web/test/components/ExecutiveSummarySection.test.tsx`

**Interfaces:**
- Consumes: `SprintReportRowData` from `../sprintReports` (Task 9).
- Produces: `ImpactAnalysisSection` (props: `rows`, `onRowsChange`), `ExecutiveSummarySection` (props: `rows`, `onRowsChange`) — Task 12 composes these.

- [ ] **Step 1: Write the failing Impact Analysis test**

Create `packages/web/test/components/ImpactAnalysisSection.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImpactAnalysisSection } from '../../src/components/ImpactAnalysisSection';
import type { SprintReportRowData } from '../../src/sprintReports';

function row(overrides: Partial<SprintReportRowData> = {}): SprintReportRowData {
  return {
    rowKey: 'PC',
    delivery: {
      committedTickets: 0,
      committedSP: 0,
      deliveredTickets: 0,
      deliveredSP: 0,
      readyForTestTickets: 0,
      readyForTestSP: 0,
      predictability: null,
    },
    quality: { totalBugs: 0, critical: 0, major: 0, minor: 0, prodBug: 0 },
    impactAnalysis: { totalTickets: 10, iaGood: 8, iaMissingInfo: 2 },
    qualityChecklist: {
      noCriticalBug: 'unset',
      noProductionBug: 'unset',
      reopenRateUnder10: 'unset',
      uatStable: 'unset',
      assessment: 'unset',
    },
    iaWrongScope: 0,
    rootCause: [],
    missingImpact: [{ ticket: 'PC-100', missingInfo: '' }],
    executiveSummary: { delivery: 'unset', quality: 'unset', impactAnalysis: 'unset', overall: 'unset', commentary: '' },
    ...overrides,
  };
}

describe('ImpactAnalysisSection', () => {
  it('renders the auto-computed IA counts and the prefilled missing-impact ticket', () => {
    render(<ImpactAnalysisSection rows={[row()]} onRowsChange={() => {}} />);
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('PC-100')).toBeInTheDocument();
  });

  it('calls onRowsChange when IA Wrong Scope is edited', async () => {
    const onRowsChange = vi.fn();
    render(<ImpactAnalysisSection rows={[row()]} onRowsChange={onRowsChange} />);
    const input = screen.getByLabelText('PC IA Wrong Scope');
    await userEvent.clear(input);
    await userEvent.type(input, '3');
    const updatedRows = onRowsChange.mock.calls[onRowsChange.mock.calls.length - 1][0] as SprintReportRowData[];
    expect(updatedRows[0].iaWrongScope).toBe(3);
  });

  it('calls onRowsChange when a missing-info cell is edited', async () => {
    const onRowsChange = vi.fn();
    render(<ImpactAnalysisSection rows={[row()]} onRowsChange={onRowsChange} />);
    await userEvent.type(screen.getByLabelText('PC-100 missing info'), 'x');
    const updatedRows = onRowsChange.mock.calls[0][0] as SprintReportRowData[];
    expect(updatedRows[0].missingImpact[0].missingInfo).toBe('x');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/web test -- ImpactAnalysisSection.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement ImpactAnalysisSection**

Create `packages/web/src/components/ImpactAnalysisSection.tsx`:

```tsx
import type { SprintReportRowData } from '../sprintReports';

export interface ImpactAnalysisSectionProps {
  rows: SprintReportRowData[];
  onRowsChange: (rows: SprintReportRowData[]) => void;
}

function updateRow(
  rows: SprintReportRowData[],
  rowKey: SprintReportRowData['rowKey'],
  patch: Partial<SprintReportRowData>
): SprintReportRowData[] {
  return rows.map((row) => (row.rowKey === rowKey ? { ...row, ...patch } : row));
}

export function ImpactAnalysisSection({ rows, onRowsChange }: ImpactAnalysisSectionProps) {
  return (
    <section className="card">
      <h2 className="heading-md">3. Impact Analysis Review</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Squad</th>
            <th>Total Tickets</th>
            <th>IA Good</th>
            <th>IA Missing Info</th>
            <th>IA Wrong Scope</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rowKey}>
              <td>{row.rowKey}</td>
              <td>{row.impactAnalysis.totalTickets}</td>
              <td>{row.impactAnalysis.iaGood}</td>
              <td>{row.impactAnalysis.iaMissingInfo}</td>
              <td>
                <input
                  className="text-input"
                  type="number"
                  min={0}
                  aria-label={`${row.rowKey} IA Wrong Scope`}
                  value={row.iaWrongScope}
                  onChange={(e) => onRowsChange(updateRow(rows, row.rowKey, { iaWrongScope: Number(e.target.value) }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="heading-md">Missing Impact Examples</h3>
      {rows.map(
        (row) =>
          row.missingImpact.length > 0 && (
            <div key={row.rowKey}>
              <p className="body-strong">{row.rowKey}</p>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Missing Info</th>
                  </tr>
                </thead>
                <tbody>
                  {row.missingImpact.map((mi, index) => (
                    <tr key={mi.ticket}>
                      <td>{mi.ticket}</td>
                      <td>
                        <input
                          className="text-input"
                          aria-label={`${mi.ticket} missing info`}
                          value={mi.missingInfo}
                          onChange={(e) => {
                            const missingImpact = row.missingImpact.map((m, i) =>
                              i === index ? { ...m, missingInfo: e.target.value } : m
                            );
                            onRowsChange(updateRow(rows, row.rowKey, { missingImpact }));
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/web test -- ImpactAnalysisSection.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing Executive Summary test**

Create `packages/web/test/components/ExecutiveSummarySection.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExecutiveSummarySection } from '../../src/components/ExecutiveSummarySection';
import type { SprintReportRowData } from '../../src/sprintReports';

function row(overrides: Partial<SprintReportRowData> = {}): SprintReportRowData {
  return {
    rowKey: 'PC',
    delivery: {
      committedTickets: 0,
      committedSP: 0,
      deliveredTickets: 0,
      deliveredSP: 0,
      readyForTestTickets: 0,
      readyForTestSP: 0,
      predictability: null,
    },
    quality: { totalBugs: 0, critical: 0, major: 0, minor: 0, prodBug: 0 },
    impactAnalysis: { totalTickets: 0, iaGood: 0, iaMissingInfo: 0 },
    qualityChecklist: {
      noCriticalBug: 'unset',
      noProductionBug: 'unset',
      reopenRateUnder10: 'unset',
      uatStable: 'unset',
      assessment: 'unset',
    },
    iaWrongScope: 0,
    rootCause: [],
    missingImpact: [],
    executiveSummary: { delivery: 'unset', quality: 'unset', impactAnalysis: 'unset', overall: 'unset', commentary: '' },
    ...overrides,
  };
}

describe('ExecutiveSummarySection', () => {
  it('calls onRowsChange when the Overall picker changes', async () => {
    const onRowsChange = vi.fn();
    render(<ExecutiveSummarySection rows={[row()]} onRowsChange={onRowsChange} />);
    await userEvent.selectOptions(screen.getByLabelText('PC executive overall'), 'good');
    const updatedRows = onRowsChange.mock.calls[0][0] as SprintReportRowData[];
    expect(updatedRows[0].executiveSummary.overall).toBe('good');
  });

  it('calls onRowsChange when the commentary textarea changes', async () => {
    const onRowsChange = vi.fn();
    render(<ExecutiveSummarySection rows={[row()]} onRowsChange={onRowsChange} />);
    await userEvent.type(screen.getByLabelText('PC commentary'), 'x');
    const updatedRows = onRowsChange.mock.calls[0][0] as SprintReportRowData[];
    expect(updatedRows[0].executiveSummary.commentary).toBe('x');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/web test -- ExecutiveSummarySection.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 7: Implement ExecutiveSummarySection**

Create `packages/web/src/components/ExecutiveSummarySection.tsx`:

```tsx
import type { SprintReportRowData } from '../sprintReports';

export interface ExecutiveSummarySectionProps {
  rows: SprintReportRowData[];
  onRowsChange: (rows: SprintReportRowData[]) => void;
}

function updateRow(
  rows: SprintReportRowData[],
  rowKey: SprintReportRowData['rowKey'],
  patch: Partial<SprintReportRowData>
): SprintReportRowData[] {
  return rows.map((row) => (row.rowKey === rowKey ? { ...row, ...patch } : row));
}

const DELIVERY_OPTIONS = ['unset', 'good', 'bad'] as const;
const QUALITY_OPTIONS = ['unset', 'good', 'bad'] as const;
const IMPACT_ANALYSIS_OPTIONS = ['unset', 'good', 'partial', 'bad'] as const;
const OVERALL_OPTIONS = ['unset', 'good', 'medium', 'bad'] as const;

export function ExecutiveSummarySection({ rows, onRowsChange }: ExecutiveSummarySectionProps) {
  return (
    <section className="card">
      <h2 className="heading-md">4. Executive Summary (Quan trọng nhất)</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Squad</th>
            <th>Delivery</th>
            <th>Quality</th>
            <th>Impact Analysis</th>
            <th>Overall</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rowKey}>
              <td>{row.rowKey}</td>
              <td>
                <select
                  className="text-input"
                  aria-label={`${row.rowKey} executive delivery`}
                  value={row.executiveSummary.delivery}
                  onChange={(e) =>
                    onRowsChange(
                      updateRow(rows, row.rowKey, {
                        executiveSummary: { ...row.executiveSummary, delivery: e.target.value as (typeof DELIVERY_OPTIONS)[number] },
                      })
                    )
                  }
                >
                  {DELIVERY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  className="text-input"
                  aria-label={`${row.rowKey} executive quality`}
                  value={row.executiveSummary.quality}
                  onChange={(e) =>
                    onRowsChange(
                      updateRow(rows, row.rowKey, {
                        executiveSummary: { ...row.executiveSummary, quality: e.target.value as (typeof QUALITY_OPTIONS)[number] },
                      })
                    )
                  }
                >
                  {QUALITY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  className="text-input"
                  aria-label={`${row.rowKey} executive impact analysis`}
                  value={row.executiveSummary.impactAnalysis}
                  onChange={(e) =>
                    onRowsChange(
                      updateRow(rows, row.rowKey, {
                        executiveSummary: {
                          ...row.executiveSummary,
                          impactAnalysis: e.target.value as (typeof IMPACT_ANALYSIS_OPTIONS)[number],
                        },
                      })
                    )
                  }
                >
                  {IMPACT_ANALYSIS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  className="text-input"
                  aria-label={`${row.rowKey} executive overall`}
                  value={row.executiveSummary.overall}
                  onChange={(e) =>
                    onRowsChange(
                      updateRow(rows, row.rowKey, {
                        executiveSummary: { ...row.executiveSummary, overall: e.target.value as (typeof OVERALL_OPTIONS)[number] },
                      })
                    )
                  }
                >
                  {OVERALL_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {rows.map((row) => (
        <label className="label" key={row.rowKey}>
          {row.rowKey} commentary
          <textarea
            className="text-input"
            aria-label={`${row.rowKey} commentary`}
            value={row.executiveSummary.commentary}
            onChange={(e) =>
              onRowsChange(
                updateRow(rows, row.rowKey, {
                  executiveSummary: { ...row.executiveSummary, commentary: e.target.value },
                })
              )
            }
          />
        </label>
      ))}
    </section>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/web test -- ExecutiveSummarySection.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 9: Run typecheck**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: PASS, no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/web/src/components/ImpactAnalysisSection.tsx packages/web/src/components/ExecutiveSummarySection.tsx packages/web/test/components/ImpactAnalysisSection.test.tsx packages/web/test/components/ExecutiveSummarySection.test.tsx
git commit -m "feat(web): add Impact Analysis and Executive Summary section components"
```

---

### Task 12: Page composition + Sidebar/App.tsx/vite proxy wiring

**Files:**
- Create: `packages/web/src/components/SprintReportPage.tsx`
- Test: `packages/web/test/components/SprintReportPage.test.tsx`
- Modify: `packages/web/src/components/Sidebar.tsx`
- Modify: `packages/web/test/components/Sidebar.test.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/vite.config.ts`

**Interfaces:**
- Consumes: `fetchSprintReport`, `refreshSprintReport`, `saveSprintReport`, `SprintReport`, `SprintReportRowData` from `../sprintReports` (Task 9); `SprintDeliverySummarySection` (Task 10), `QualityReportSection` (Task 10), `ImpactAnalysisSection`, `ExecutiveSummarySection` (Task 11).
- Produces: `SprintReportPage` — no later task depends on this, it completes the feature end-to-end.

- [ ] **Step 1: Write the failing page test**

Create `packages/web/test/components/SprintReportPage.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SprintReportPage } from '../../src/components/SprintReportPage';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function sampleReportResponse() {
  return {
    sprintCode: '26.08.B',
    startDate: '2026/08/06',
    endDate: '2026/08/19',
    labels: ['nhuvth'],
    rows: [
      {
        rowKey: 'PC',
        delivery: {
          committedTickets: 10,
          committedSP: 80,
          deliveredTickets: 8,
          deliveredSP: 70,
          readyForTestTickets: 9,
          readyForTestSP: 75,
          predictability: 0.875,
        },
        quality: { totalBugs: 25, critical: 0, major: 3, minor: 22, prodBug: 0 },
        impactAnalysis: { totalTickets: 10, iaGood: 8, iaMissingInfo: 2 },
        qualityChecklist: {
          noCriticalBug: 'unset',
          noProductionBug: 'unset',
          reopenRateUnder10: 'unset',
          uatStable: 'unset',
          assessment: 'unset',
        },
        iaWrongScope: 0,
        rootCause: [],
        missingImpact: [],
        executiveSummary: { delivery: 'unset', quality: 'unset', impactAnalysis: 'unset', overall: 'unset', commentary: '' },
      },
    ],
    deliveryComment: '',
    createdAt: '',
    updatedAt: '',
  };
}

describe('SprintReportPage', () => {
  it('generates a report and renders all 4 sections', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(sampleReportResponse()) }));
    render(<SprintReportPage />);

    await userEvent.type(screen.getByLabelText('Sprint Code'), '26.08.B');
    await userEvent.type(screen.getByLabelText('Start Date'), '2026/08/06');
    await userEvent.type(screen.getByLabelText('End Date'), '2026/08/19');
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(await screen.findByText('1. Sprint Delivery Summary')).toBeInTheDocument();
    expect(screen.getByText('2. Quality Report')).toBeInTheDocument();
    expect(screen.getByText('3. Impact Analysis Review')).toBeInTheDocument();
    expect(screen.getByText('4. Executive Summary (Quan trọng nhất)')).toBeInTheDocument();
  });

  it('shows an error when Generate fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({ error: 'Jira is not configured' }) })
    );
    render(<SprintReportPage />);

    await userEvent.type(screen.getByLabelText('Sprint Code'), '26.08.B');
    await userEvent.type(screen.getByLabelText('Start Date'), '2026/08/06');
    await userEvent.type(screen.getByLabelText('End Date'), '2026/08/19');
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Jira is not configured');
  });

  it('loads a previously saved report via Load Saved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(sampleReportResponse()) }));
    render(<SprintReportPage />);

    await userEvent.type(screen.getByLabelText('Sprint Code'), '26.08.B');
    await userEvent.click(screen.getByRole('button', { name: 'Load Saved' }));

    expect(await screen.findByText('1. Sprint Delivery Summary')).toBeInTheDocument();
    expect(screen.getByLabelText('Start Date')).toHaveValue('2026/08/06');
  });

  it('saves the current report via Save', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(sampleReportResponse()) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SprintReportPage />);

    await userEvent.type(screen.getByLabelText('Sprint Code'), '26.08.B');
    await userEvent.type(screen.getByLabelText('Start Date'), '2026/08/06');
    await userEvent.type(screen.getByLabelText('End Date'), '2026/08/19');
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await screen.findByText('1. Sprint Delivery Summary');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(fetchMock).toHaveBeenCalledWith('/sprint-reports/26.08.B', expect.objectContaining({ method: 'PUT' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/web test -- SprintReportPage.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement SprintReportPage**

Create `packages/web/src/components/SprintReportPage.tsx`:

```tsx
import { useState } from 'react';
import {
  fetchSprintReport,
  refreshSprintReport,
  saveSprintReport,
  type SprintReport,
  type SprintReportRowData,
} from '../sprintReports';
import { SprintDeliverySummarySection } from './SprintDeliverySummarySection';
import { QualityReportSection } from './QualityReportSection';
import { ImpactAnalysisSection } from './ImpactAnalysisSection';
import { ExecutiveSummarySection } from './ExecutiveSummarySection';

export function SprintReportPage() {
  const [sprintCode, setSprintCode] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [labelsInput, setLabelsInput] = useState('');
  const [report, setReport] = useState<SprintReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const labels = labelsInput
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label !== '');

  async function handleLoad() {
    setError(null);
    const existing = await fetchSprintReport(sprintCode);
    if (existing) {
      setReport(existing);
      setStartDate(existing.startDate);
      setEndDate(existing.endDate);
      setLabelsInput(existing.labels.join(', '));
    } else {
      setError(`No saved report found for "${sprintCode}".`);
    }
  }

  async function handleGenerate() {
    setError(null);
    try {
      const refreshed = await refreshSprintReport(sprintCode, { startDate, endDate, labels });
      setReport(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSave() {
    if (!report) {
      return;
    }
    setError(null);
    try {
      const saved = await saveSprintReport(report);
      setReport(saved);
    } catch {
      setError('Could not save the sprint report.');
    }
  }

  function updateReportRows(rows: SprintReportRowData[]) {
    if (report) {
      setReport({ ...report, rows });
    }
  }

  return (
    <main className="app-main">
      <h1 className="heading-xl">Sprint Report</h1>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}

      <section className="card">
        <label className="label">
          Sprint Code
          <input className="text-input" value={sprintCode} onChange={(e) => setSprintCode(e.target.value)} />
        </label>
        <label className="label">
          Start Date
          <input
            className="text-input"
            placeholder="2026/08/06"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label className="label">
          End Date
          <input
            className="text-input"
            placeholder="2026/08/19"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
        <label className="label">
          Labels
          <input
            className="text-input"
            placeholder="nhuvth, minh2, ..."
            value={labelsInput}
            onChange={(e) => setLabelsInput(e.target.value)}
          />
        </label>
        <button type="button" className="btn-secondary" disabled={sprintCode.trim() === ''} onClick={handleLoad}>
          Load Saved
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={sprintCode.trim() === '' || startDate.trim() === '' || endDate.trim() === ''}
          onClick={handleGenerate}
        >
          Generate
        </button>
      </section>

      {report && (
        <>
          <SprintDeliverySummarySection
            rows={report.rows}
            onRowsChange={updateReportRows}
            deliveryComment={report.deliveryComment}
            onDeliveryCommentChange={(deliveryComment) => setReport({ ...report, deliveryComment })}
          />
          <QualityReportSection rows={report.rows} onRowsChange={updateReportRows} />
          <ImpactAnalysisSection rows={report.rows} onRowsChange={updateReportRows} />
          <ExecutiveSummarySection rows={report.rows} onRowsChange={updateReportRows} />
          <button type="button" className="btn-primary" onClick={handleSave}>
            Save
          </button>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/web test -- SprintReportPage.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the Sidebar nav entry**

Modify `packages/web/src/components/Sidebar.tsx`, changing:

```tsx
      <NavLink
        to="/kafka-contract-checks"
        className={({ isActive }) => (isActive ? 'sidebar-link sidebar-link--active' : 'sidebar-link')}
      >
        Kafka Contract Checks
      </NavLink>
    </nav>
  );
}
```

to:

```tsx
      <NavLink
        to="/kafka-contract-checks"
        className={({ isActive }) => (isActive ? 'sidebar-link sidebar-link--active' : 'sidebar-link')}
      >
        Kafka Contract Checks
      </NavLink>
      <NavLink
        to="/sprint-report"
        className={({ isActive }) => (isActive ? 'sidebar-link sidebar-link--active' : 'sidebar-link')}
      >
        Sprint Report
      </NavLink>
    </nav>
  );
}
```

- [ ] **Step 6: Update the Sidebar test**

Replace the entire contents of `packages/web/test/components/Sidebar.test.tsx` with:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../../src/components/Sidebar';

function renderSidebar(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Sidebar />
    </MemoryRouter>
  );
}

const ALL_LINKS = [
  'Simple Mode',
  'Manage Load Reusable Step',
  'End-to-end test',
  'API Automation',
  'Check Kafka',
  'Kafka Contract Checks',
  'Sprint Report',
];

const LINK_HREFS: Record<string, string> = {
  'Simple Mode': '/',
  'Manage Load Reusable Step': '/manage-steps',
  'End-to-end test': '/e2e-test',
  'API Automation': '/api-automation',
  'Check Kafka': '/kafka-checks',
  'Kafka Contract Checks': '/kafka-contract-checks',
  'Sprint Report': '/sprint-report',
};

describe('Sidebar', () => {
  it('renders all seven nav items with the correct hrefs', () => {
    renderSidebar('/');
    for (const name of ALL_LINKS) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', LINK_HREFS[name]);
    }
  });

  for (const activeName of ALL_LINKS) {
    it(`marks ${activeName} active on ${LINK_HREFS[activeName]}, not the others`, () => {
      renderSidebar(LINK_HREFS[activeName]);
      expect(screen.getByRole('link', { name: activeName })).toHaveAttribute('aria-current', 'page');
      for (const otherName of ALL_LINKS) {
        if (otherName !== activeName) {
          expect(screen.getByRole('link', { name: otherName })).not.toHaveAttribute('aria-current');
        }
      }
    });
  }
});
```

- [ ] **Step 7: Wire the route into App.tsx**

Modify `packages/web/src/App.tsx`'s import block, changing:

```ts
import { KafkaContractChecksPage } from './components/KafkaContractChecksPage';
```

to:

```ts
import { KafkaContractChecksPage } from './components/KafkaContractChecksPage';
import { SprintReportPage } from './components/SprintReportPage';
```

Modify the routes, changing:

```tsx
          <Route path="/kafka-contract-checks" element={<KafkaContractChecksPage />} />
        </Routes>
```

to:

```tsx
          <Route path="/kafka-contract-checks" element={<KafkaContractChecksPage />} />
          <Route path="/sprint-report" element={<SprintReportPage />} />
        </Routes>
```

- [ ] **Step 8: Add the dev proxy entry**

Modify `packages/web/vite.config.ts`'s proxy map, changing:

```ts
      '/kafka-contract-checks': 'http://localhost:3000',
    },
```

to:

```ts
      '/kafka-contract-checks': 'http://localhost:3000',
      '/sprint-reports': 'http://localhost:3000',
    },
```

- [ ] **Step 9: Run the full web test suite and typecheck**

Run: `pnpm --filter @ai-native-testing/web test && pnpm --filter @ai-native-testing/web typecheck`
Expected: PASS — all existing tests plus the new ones.

- [ ] **Step 10: Run the full workspace test suite and typecheck**

Run: `pnpm test && pnpm typecheck` (from the repo root)
Expected: PASS across all six packages.

- [ ] **Step 11: Commit**

```bash
git add packages/web/src/components/SprintReportPage.tsx packages/web/test/components/SprintReportPage.test.tsx packages/web/src/components/Sidebar.tsx packages/web/test/components/Sidebar.test.tsx packages/web/src/App.tsx packages/web/vite.config.ts
git commit -m "feat(web): add Sprint Report page, sidebar entry, routing, and dev proxy"
```
