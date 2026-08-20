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
      [issue('A', 5), issue('C', 2)],
      [issue('B', 3)]
    );
    expect(row).toEqual({
      committedTickets: 2,
      committedSP: 8,
      deliveredTickets: 1,
      deliveredSP: 5,
      readyForTestTickets: 2,
      readyForTestSP: 7,
      predictability: 5 / 8,
      predictabilityRFT: 7 / 8,
      newTickets: 1,
      newSP: 3,
      predictabilityNew: 3 / 8,
    });
  });

  it('treats a missing Story Points value as 0', () => {
    const row = computeDeliveryRow([issue('A', null)], [], [], []);
    expect(row.committedSP).toBe(0);
  });

  it('returns null for every predictability variant when committed SP is 0', () => {
    const row = computeDeliveryRow([], [], [], []);
    expect(row.predictability).toBeNull();
    expect(row.predictabilityRFT).toBeNull();
    expect(row.predictabilityNew).toBeNull();
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
