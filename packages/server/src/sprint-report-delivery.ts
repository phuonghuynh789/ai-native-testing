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

export interface SandboxDateBreakdown {
  readyOrInTestTickets: number;
  missingSandboxDate: number;
  sandboxDateEqualsSprintEnd: number;
  sandboxDateMinus1: number;
  sandboxDatePlus1: number;
  sandboxDatePlus2: number;
}

const READY_OR_IN_TEST_STATUSES = new Set(['ready for testing', 'in test']);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function filterReadyOrInTest(issues: JiraIssue[]): JiraIssue[] {
  return issues.filter((issue) => READY_OR_IN_TEST_STATUSES.has(issue.status.toLowerCase()));
}

function parseDate(dateStr: string): Date | null {
  const date = new Date(`${dateStr.replaceAll('/', '-')}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

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

export function computeSandboxDateBreakdown(committed: JiraIssue[], sprintEndDate: string): SandboxDateBreakdown {
  const readyOrInTest = filterReadyOrInTest(committed);
  const endDate = parseDate(sprintEndDate);

  const breakdown: SandboxDateBreakdown = {
    readyOrInTestTickets: readyOrInTest.length,
    missingSandboxDate: 0,
    sandboxDateEqualsSprintEnd: 0,
    sandboxDateMinus1: 0,
    sandboxDatePlus1: 0,
    sandboxDatePlus2: 0,
  };

  for (const issue of readyOrInTest) {
    if (!issue.sandboxDate) {
      breakdown.missingSandboxDate += 1;
      continue;
    }
    const sandboxDate = parseDate(issue.sandboxDate);
    if (!sandboxDate || !endDate) {
      continue;
    }
    const offsetDays = Math.round((sandboxDate.getTime() - endDate.getTime()) / MS_PER_DAY);
    if (offsetDays === 0) {
      breakdown.sandboxDateEqualsSprintEnd += 1;
    } else if (offsetDays === -1) {
      breakdown.sandboxDateMinus1 += 1;
    } else if (offsetDays === 1) {
      breakdown.sandboxDatePlus1 += 1;
    } else if (offsetDays === 2) {
      breakdown.sandboxDatePlus2 += 1;
    }
  }

  return breakdown;
}
