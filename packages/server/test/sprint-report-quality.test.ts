import { describe, it, expect } from 'vitest';
import { mapPriorityToSeverity, isProdBug, computeQualityRow } from '../src/sprint-report-quality.js';
import type { JiraIssue } from '../src/jira-client.js';

function bug(priority: string | null, bugEnvironments: string[] = []): JiraIssue {
  return {
    key: 'BUG-1',
    project: 'PC',
    summary: '',
    status: 'Open',
    priority,
    labels: [],
    storyPoints: null,
    productDomain: null,
    bugEnvironments,
  };
}

describe('mapPriorityToSeverity', () => {
  it('maps Highest to critical', () => {
    expect(mapPriorityToSeverity('Highest')).toBe('critical');
  });

  it('maps High and Medium to major', () => {
    expect(mapPriorityToSeverity('High')).toBe('major');
    expect(mapPriorityToSeverity('Medium')).toBe('major');
  });

  it('maps Low and Lowest to minor', () => {
    expect(mapPriorityToSeverity('Low')).toBe('minor');
    expect(mapPriorityToSeverity('Lowest')).toBe('minor');
  });

  it('maps an unrecognized or missing priority to null', () => {
    expect(mapPriorityToSeverity('Unknown')).toBeNull();
    expect(mapPriorityToSeverity(null)).toBeNull();
  });
});

describe('isProdBug', () => {
  it('is true when Production is one of the bug environments', () => {
    expect(isProdBug(['Production', 'Staging'])).toBe(true);
  });

  it('is false when Production is absent', () => {
    expect(isProdBug(['Staging'])).toBe(false);
    expect(isProdBug([])).toBe(false);
  });
});

describe('computeQualityRow', () => {
  it('tallies severity and prod-bug counts across all bugs', () => {
    const row = computeQualityRow([
      bug('Highest', ['Production']),
      bug('High'),
      bug('Low'),
      bug('Medium', ['Production']),
    ]);
    expect(row).toEqual({ totalBugs: 4, critical: 1, major: 2, minor: 1, prodBug: 2 });
  });

  it('returns all zeros for an empty bug list', () => {
    expect(computeQualityRow([])).toEqual({ totalBugs: 0, critical: 0, major: 0, minor: 0, prodBug: 0 });
  });
});
