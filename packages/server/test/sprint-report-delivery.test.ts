import { describe, it, expect } from 'vitest';
import { computeDeliveryRow, prefillRootCauseTable } from '../src/sprint-report-delivery.js';
import type { JiraIssue } from '../src/jira-client.js';

function issue(key: string, storyPoints: number | null, overrides: Partial<JiraIssue> = {}): JiraIssue {
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
    sandboxDate: null,
    ...overrides,
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
  it('lists a committed, undelivered ticket that is Ready for Testing, with sandboxDate prefilled and manual fields blank', () => {
    const rows = prefillRootCauseTable(
      [issue('A', 5, { status: 'Ready for Testing', sandboxDate: '2026-08-15' }), issue('B', 3, { status: 'Done' })],
      []
    );
    expect(rows).toEqual([{ ticket: 'A', sandboxDate: '2026-08-15', reason: '', owner: '', action: '' }]);
  });

  it('matches the Ready for Testing / In Test statuses case-insensitively', () => {
    const rows = prefillRootCauseTable(
      [issue('A', 5, { status: 'ready for testing' }), issue('B', 3, { status: 'in test' })],
      []
    );
    expect(rows.map((r) => r.ticket)).toEqual(['A', 'B']);
  });

  it('excludes a committed, undelivered ticket whose status is neither Ready for Testing nor In Test', () => {
    const rows = prefillRootCauseTable([issue('A', 5, { status: 'To Do' })], []);
    expect(rows).toEqual([]);
  });

  it('excludes a ticket that is Ready for Testing but already delivered', () => {
    const rows = prefillRootCauseTable(
      [issue('A', 5, { status: 'Ready for Testing' })],
      [issue('A', 5, { status: 'Ready for Testing' })]
    );
    expect(rows).toEqual([]);
  });
});
