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
