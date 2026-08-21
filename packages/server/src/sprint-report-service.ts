import type { JiraConfig } from './jira-config.js';
import { searchJiraIssues, fetchIssueTextForKeywordCheck } from './jira-client.js';
import { buildCommittedJql, buildNewJql, buildDeliveredJql, buildBugsJql } from './sprint-report-jql.js';
import { ROW_KEYS, groupIssuesByRow, type RowKey } from './sprint-report-rows.js';
import { computeDeliveryRow, computeSandboxDateBreakdown } from './sprint-report-delivery.js';
import { computeQualityRow, hasRootCauseKeyword } from './sprint-report-quality.js';
import {
  buildDeliveryJiraLinks,
  buildQualityJiraLinks,
  buildSandboxDateJiraLinks,
  buildImpactAnalysisJiraLinks,
} from './sprint-report-jira-links.js';
import { hasImpactAnalysisKeyword, computeImpactAnalysisRow } from './sprint-report-impact-analysis.js';
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
      predictabilityRFT: null,
      newTickets: 0,
      newSP: 0,
      predictabilityNew: null,
    },
    deliveryJiraLinks: { committed: '', delivered: '', readyForTest: '', new: '' },
    quality: { totalBugs: 0, critical: 0, major: 0, minor: 0, prodBug: 0, noRC: 0 },
    qualityJiraLinks: { totalBugs: '', critical: '', major: '', minor: '', prodBug: '', noRC: '' },
    impactAnalysis: { totalTickets: 0, iaGood: 0, iaMissingInfo: 0 },
    impactAnalysisJiraLinks: { iaGood: '', iaMissingInfo: '' },
    sandboxDateBreakdown: {
      ticketsInSprint: 0,
      missingSandboxDate: 0,
      ticketsCreatedMidSprint: 0,
      sandboxDateEqualsSprintEnd: 0,
      sandboxDateMinus1: 0,
      sandboxDatePlus1: 0,
      sandboxDatePlus2: 0,
    },
    sandboxDateJiraLinks: {
      ticketsInSprint: '',
      missingSandboxDate: '',
      createdMidSprint: '',
      equalsSprintEnd: '',
      minus1: '',
      plus1: '',
      plus2: '',
    },
    executiveSummary: {
      delivery: 'unset',
      quality: 'unset',
      impactAnalysis: 'unset',
      overall: 'unset',
      commentary: '',
    },
  };
}

export async function refreshSprintReport(
  jiraConfig: JiraConfig,
  store: SprintReportStore,
  sprintCode: string,
  params: RefreshParams
): Promise<SprintReport> {
  const jqlParams = { start: params.startDate, end: params.endDate, labels: params.labels };

  const [committed, newIssues, delivered, bugs] = await Promise.all([
    searchJiraIssues(jiraConfig, buildCommittedJql({ sprintCode })),
    searchJiraIssues(jiraConfig, buildNewJql({ sprintCode })),
    searchJiraIssues(jiraConfig, buildDeliveredJql(jqlParams)),
    searchJiraIssues(jiraConfig, buildBugsJql(jqlParams)),
  ]);

  const committedByRow = groupIssuesByRow(committed);
  const newByRow = groupIssuesByRow(newIssues);
  const deliveredByRow = groupIssuesByRow(delivered);
  const bugsByRow = groupIssuesByRow(bugs);

  const previous = await store.get(sprintCode);
  const previousRows = new Map((previous?.rows ?? []).map((row) => [row.rowKey, row]));

  const rows: SprintReportRowData[] = [];
  for (const rowKey of ROW_KEYS) {
    const rowCommitted = committedByRow[rowKey];
    const rowNew = newByRow[rowKey];
    const rowDelivered = deliveredByRow[rowKey];
    const rowReadyForTest = rowCommitted;
    const rowBugs = bugsByRow[rowKey];

    const keywordResults = await Promise.all(
      rowReadyForTest.map(async (issue) => {
        const text = await fetchIssueTextForKeywordCheck(jiraConfig, issue.key);
        return hasImpactAnalysisKeyword(text);
      })
    );

    const rootCauseResults = await Promise.all(
      rowBugs.map(async (issue) => {
        const text = await fetchIssueTextForKeywordCheck(jiraConfig, issue.key);
        return hasRootCauseKeyword(text);
      })
    );

    const previousRow = previousRows.get(rowKey);
    const base = previousRow ?? defaultRowData(rowKey);

    rows.push({
      rowKey,
      delivery: computeDeliveryRow(rowCommitted, rowDelivered, rowReadyForTest, rowNew),
      deliveryJiraLinks: buildDeliveryJiraLinks(jiraConfig, rowKey, sprintCode, jqlParams),
      quality: computeQualityRow(rowBugs, rootCauseResults),
      qualityJiraLinks: buildQualityJiraLinks(jiraConfig, rowKey, jqlParams),
      impactAnalysis: computeImpactAnalysisRow(keywordResults),
      impactAnalysisJiraLinks: buildImpactAnalysisJiraLinks(jiraConfig, rowKey, sprintCode),
      sandboxDateBreakdown: computeSandboxDateBreakdown(rowCommitted, params.startDate, params.endDate),
      sandboxDateJiraLinks: buildSandboxDateJiraLinks(jiraConfig, rowKey, sprintCode, params.startDate, params.endDate),
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
    qualityComment: previous?.qualityComment ?? '',
    impactAnalysisComment: previous?.impactAnalysisComment ?? '',
    createdAt: previous?.createdAt ?? '',
    updatedAt: previous?.updatedAt ?? '',
  };
}
