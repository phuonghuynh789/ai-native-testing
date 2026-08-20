import type { JiraConfig } from './jira-config.js';
import { jqlProjectScope, type RowKey } from './sprint-report-rows.js';
import {
  buildCommittedJql,
  buildNewJql,
  buildDeliveredJql,
  buildReadyForTestJql,
  buildBugsJql,
  addDays,
  type JqlDateParams,
} from './sprint-report-jql.js';

export interface DeliveryJiraLinks {
  committed: string;
  delivered: string;
  readyForTest: string;
  new: string;
}

export interface QualityJiraLinks {
  totalBugs: string;
  critical: string;
  major: string;
  minor: string;
  prodBug: string;
}

export interface SandboxDateJiraLinks {
  readyOrInTest: string;
  missingSandboxDate: string;
  equalsSprintEnd: string;
  minus1: string;
  plus1: string;
  plus2: string;
}

function jiraSearchUrl(baseUrl: string, jql: string): string {
  return `${baseUrl}/issues/?jql=${encodeURIComponent(jql)}`;
}

export function buildDeliveryJiraLinks(
  jiraConfig: JiraConfig,
  rowKey: RowKey,
  sprintCode: string,
  dateParams: JqlDateParams
): DeliveryJiraLinks {
  const scope = jqlProjectScope(rowKey);
  return {
    committed: jiraSearchUrl(jiraConfig.baseUrl, `${buildCommittedJql({ sprintCode })} AND ${scope}`),
    delivered: jiraSearchUrl(jiraConfig.baseUrl, `${buildDeliveredJql(dateParams)} AND ${scope}`),
    readyForTest: jiraSearchUrl(jiraConfig.baseUrl, `${buildReadyForTestJql(dateParams)} AND ${scope}`),
    new: jiraSearchUrl(jiraConfig.baseUrl, `${buildNewJql({ sprintCode })} AND ${scope}`),
  };
}

export function buildSandboxDateJiraLinks(
  jiraConfig: JiraConfig,
  rowKey: RowKey,
  sprintCode: string,
  sprintEndDate: string
): SandboxDateJiraLinks {
  const scope = jqlProjectScope(rowKey);
  const readyOrInTestJql = `${buildCommittedJql({ sprintCode })} AND status in ("Ready for Testing", "In Test") AND ${scope}`;
  return {
    readyOrInTest: jiraSearchUrl(jiraConfig.baseUrl, readyOrInTestJql),
    missingSandboxDate: jiraSearchUrl(jiraConfig.baseUrl, `${readyOrInTestJql} AND "Sandbox Date" is EMPTY`),
    equalsSprintEnd: jiraSearchUrl(jiraConfig.baseUrl, `${readyOrInTestJql} AND "Sandbox Date" = "${sprintEndDate}"`),
    minus1: jiraSearchUrl(
      jiraConfig.baseUrl,
      `${readyOrInTestJql} AND "Sandbox Date" = "${addDays(sprintEndDate, -1)}"`
    ),
    plus1: jiraSearchUrl(
      jiraConfig.baseUrl,
      `${readyOrInTestJql} AND "Sandbox Date" = "${addDays(sprintEndDate, 1)}"`
    ),
    plus2: jiraSearchUrl(
      jiraConfig.baseUrl,
      `${readyOrInTestJql} AND "Sandbox Date" = "${addDays(sprintEndDate, 2)}"`
    ),
  };
}

export function buildQualityJiraLinks(
  jiraConfig: JiraConfig,
  rowKey: RowKey,
  dateParams: Pick<JqlDateParams, 'start' | 'end'>
): QualityJiraLinks {
  const scope = jqlProjectScope(rowKey);
  const bugsJql = buildBugsJql(dateParams);
  return {
    totalBugs: jiraSearchUrl(jiraConfig.baseUrl, `${bugsJql} AND ${scope}`),
    critical: jiraSearchUrl(jiraConfig.baseUrl, `${bugsJql} AND ${scope} AND priority in ("P1 (Highest)", "P2 (High)")`),
    major: jiraSearchUrl(jiraConfig.baseUrl, `${bugsJql} AND ${scope} AND priority = "P3 (Medium)"`),
    minor: jiraSearchUrl(jiraConfig.baseUrl, `${bugsJql} AND ${scope} AND priority in ("P4 (Low)", "P5 (Lowest)")`),
    prodBug: jiraSearchUrl(jiraConfig.baseUrl, `${bugsJql} AND ${scope} AND "Bug in Environments:" = Production`),
  };
}
