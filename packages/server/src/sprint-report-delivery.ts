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
