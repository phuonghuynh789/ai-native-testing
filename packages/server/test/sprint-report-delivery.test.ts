import { describe, it, expect } from 'vitest';
import { computeDeliveryRow, computeSandboxDateBreakdown, filterReadyOrInTest } from '../src/sprint-report-delivery.js';
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

describe('filterReadyOrInTest', () => {
  it('keeps only tickets currently Ready for Testing or In Test, matching case-insensitively', () => {
    const filtered = filterReadyOrInTest([
      issue('A', 5, { status: 'Ready for Testing' }),
      issue('B', 3, { status: 'in test' }),
      issue('C', 2, { status: 'Done' }),
    ]);
    expect(filtered.map((i) => i.key)).toEqual(['A', 'B']);
  });
});

describe('computeSandboxDateBreakdown', () => {
  it('counts committed tickets currently Ready for Testing or In Test, matching case-insensitively', () => {
    const breakdown = computeSandboxDateBreakdown(
      [
        issue('A', 5, { status: 'Ready for Testing' }),
        issue('B', 3, { status: 'in test' }),
        issue('C', 2, { status: 'To Do' }),
      ],
      '2026/08/19'
    );
    expect(breakdown.readyOrInTestTickets).toBe(2);
  });

  it('counts tickets with no Sandbox Date set', () => {
    const breakdown = computeSandboxDateBreakdown(
      [issue('A', 5, { status: 'Ready for Testing', sandboxDate: null })],
      '2026/08/19'
    );
    expect(breakdown.missingSandboxDate).toBe(1);
  });

  it('buckets Sandbox Date by its offset from the sprint end date', () => {
    const breakdown = computeSandboxDateBreakdown(
      [
        issue('A', 5, { status: 'Ready for Testing', sandboxDate: '2026-08-19' }), // = end
        issue('B', 3, { status: 'In Test', sandboxDate: '2026-08-18' }), // end - 1
        issue('C', 2, { status: 'Ready for Testing', sandboxDate: '2026-08-20' }), // end + 1
        issue('D', 1, { status: 'In Test', sandboxDate: '2026-08-21' }), // end + 2
        issue('E', 4, { status: 'Ready for Testing', sandboxDate: '2026-08-10' }), // outside all buckets
      ],
      '2026/08/19'
    );
    expect(breakdown).toEqual({
      readyOrInTestTickets: 5,
      missingSandboxDate: 0,
      sandboxDateEqualsSprintEnd: 1,
      sandboxDateMinus1: 1,
      sandboxDatePlus1: 1,
      sandboxDatePlus2: 1,
    });
  });

  it('handles a Sandbox Date given in slash-separated format the same as dash-separated', () => {
    const breakdown = computeSandboxDateBreakdown(
      [issue('A', 5, { status: 'Ready for Testing', sandboxDate: '2026/08/19' })],
      '2026/08/19'
    );
    expect(breakdown.sandboxDateEqualsSprintEnd).toBe(1);
  });
});
