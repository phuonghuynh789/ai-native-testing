import type { JiraConfig } from './jira-config.js';
import { searchJiraIssues, fetchIssueTextForKeywordCheck } from './jira-client.js';
import {
  buildCommittedJql,
  buildNewJql,
  buildDeliveredJql,
  buildReadyForTestJql,
  buildBugsJql,
} from './sprint-report-jql.js';
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
      predictabilityRFT: null,
      newTickets: 0,
      newSP: 0,
      predictabilityNew: null,
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

  const [committed, newIssues, delivered, readyForTest, bugs] = await Promise.all([
    searchJiraIssues(jiraConfig, buildCommittedJql({ sprintCode })),
    searchJiraIssues(jiraConfig, buildNewJql({ sprintCode })),
    searchJiraIssues(jiraConfig, buildDeliveredJql(jqlParams)),
    searchJiraIssues(jiraConfig, buildReadyForTestJql(jqlParams)),
    searchJiraIssues(jiraConfig, buildBugsJql(jqlParams)),
  ]);

  const committedByRow = groupIssuesByRow(committed);
  const newByRow = groupIssuesByRow(newIssues);
  const deliveredByRow = groupIssuesByRow(delivered);
  const readyForTestByRow = groupIssuesByRow(readyForTest);
  const bugsByRow = groupIssuesByRow(bugs);

  const previous = await store.get(sprintCode);
  const previousRows = new Map((previous?.rows ?? []).map((row) => [row.rowKey, row]));

  const rows: SprintReportRowData[] = [];
  for (const rowKey of ROW_KEYS) {
    const rowCommitted = committedByRow[rowKey];
    const rowNew = newByRow[rowKey];
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
      delivery: computeDeliveryRow(rowCommitted, rowDelivered, rowReadyForTest, rowNew),
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
