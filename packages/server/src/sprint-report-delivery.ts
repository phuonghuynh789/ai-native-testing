import type { JiraIssue } from './jira-client.js';

export interface DeliveryRow {
  committedTickets: number;
  committedSP: number;
  deliveredTickets: number;
  deliveredSP: number;
  readyForTestTickets: number;
  readyForTestSP: number;
  predictability: number | null;
  predictabilityRFT: number | null;
  newTickets: number;
  newSP: number;
  predictabilityNew: number | null;
}

export interface RootCauseRow {
  ticket: string;
  sandboxDate: string | null;
  reason: string;
  owner: string;
  action: string;
}

const ROOT_CAUSE_STATUSES = new Set(['ready for testing', 'in test']);

function sumStoryPoints(issues: JiraIssue[]): number {
  return issues.reduce((sum, issue) => sum + (issue.storyPoints ?? 0), 0);
}

export function computeDeliveryRow(
  committed: JiraIssue[],
  delivered: JiraIssue[],
  readyForTest: JiraIssue[],
  newIssues: JiraIssue[]
): DeliveryRow {
  const committedSP = sumStoryPoints(committed);
  const deliveredSP = sumStoryPoints(delivered);
  const readyForTestSP = sumStoryPoints(readyForTest);
  const newSP = sumStoryPoints(newIssues);
  return {
    committedTickets: committed.length,
    committedSP,
    deliveredTickets: delivered.length,
    deliveredSP,
    readyForTestTickets: readyForTest.length,
    readyForTestSP,
    predictability: committedSP > 0 ? deliveredSP / committedSP : null,
    predictabilityRFT: committedSP > 0 ? readyForTestSP / committedSP : null,
    newTickets: newIssues.length,
    newSP,
    predictabilityNew: committedSP > 0 ? newSP / committedSP : null,
  };
}

export function prefillRootCauseTable(committed: JiraIssue[], delivered: JiraIssue[]): RootCauseRow[] {
  const deliveredKeys = new Set(delivered.map((issue) => issue.key));
  return committed
    .filter((issue) => !deliveredKeys.has(issue.key))
    .filter((issue) => ROOT_CAUSE_STATUSES.has(issue.status.toLowerCase()))
    .map((issue) => ({ ticket: issue.key, sandboxDate: issue.sandboxDate, reason: '', owner: '', action: '' }));
}
