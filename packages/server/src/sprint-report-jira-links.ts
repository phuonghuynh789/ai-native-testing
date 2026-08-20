import type { JiraConfig } from './jira-config.js';
import { jqlProjectScope, type RowKey } from './sprint-report-rows.js';
import { buildCommittedJql, buildNewJql, buildDeliveredJql, buildReadyForTestJql, buildBugsJql, type JqlDateParams } from './sprint-report-jql.js';

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

export function buildQualityJiraLinks(
  jiraConfig: JiraConfig,
  rowKey: RowKey,
  dateParams: Pick<JqlDateParams, 'start' | 'end'>
): QualityJiraLinks {
  const scope = jqlProjectScope(rowKey);
  const bugsJql = buildBugsJql(dateParams);
  return {
    totalBugs: jiraSearchUrl(jiraConfig.baseUrl, `${bugsJql} AND ${scope}`),
    critical: jiraSearchUrl(jiraConfig.baseUrl, `${bugsJql} AND ${scope} AND priority = Highest`),
    major: jiraSearchUrl(jiraConfig.baseUrl, `${bugsJql} AND ${scope} AND priority in (High, Medium)`),
    minor: jiraSearchUrl(jiraConfig.baseUrl, `${bugsJql} AND ${scope} AND priority in (Low, Lowest)`),
    prodBug: jiraSearchUrl(jiraConfig.baseUrl, `${bugsJql} AND ${scope} AND "Bug in Environments:" = Production`),
  };
}
