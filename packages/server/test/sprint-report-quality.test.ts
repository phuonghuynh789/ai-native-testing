import { describe, it, expect } from 'vitest';
import { mapPriorityToSeverity, isProdBug, hasRootCauseKeyword, computeQualityRow } from '../src/sprint-report-quality.js';
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
    sandboxDate: null,
  };
}

describe('mapPriorityToSeverity', () => {
  it('maps P1 (Highest) and P2 (High) to critical', () => {
    expect(mapPriorityToSeverity('P1 (Highest)')).toBe('critical');
    expect(mapPriorityToSeverity('P2 (High)')).toBe('critical');
  });

  it('maps P3 (Medium) to major', () => {
    expect(mapPriorityToSeverity('P3 (Medium)')).toBe('major');
  });

  it('maps P4 (Low) and P5 (Lowest) to minor', () => {
    expect(mapPriorityToSeverity('P4 (Low)')).toBe('minor');
    expect(mapPriorityToSeverity('P5 (Lowest)')).toBe('minor');
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

describe('hasRootCauseKeyword', () => {
  it('matches a standalone "RC" acronym, case-insensitively', () => {
    expect(hasRootCauseKeyword('See RC notes below')).toBe(true);
    expect(hasRootCauseKeyword('see rc notes below')).toBe(true);
  });

  it('does not match "rc" embedded inside an unrelated word', () => {
    expect(hasRootCauseKeyword('Please search the archive')).toBe(false);
  });

  it('matches the phrase "root cause", case-insensitively', () => {
    expect(hasRootCauseKeyword('Root Cause: flaky network')).toBe(true);
    expect(hasRootCauseKeyword('root cause identified')).toBe(true);
  });

  it('returns false when neither keyword is present', () => {
    expect(hasRootCauseKeyword('Just a normal description')).toBe(false);
  });
});

describe('computeQualityRow', () => {
  it('tallies severity and prod-bug counts across all bugs', () => {
    const bugs = [
      bug('P1 (Highest)', ['Production']),
      bug('P2 (High)'),
      bug('P4 (Low)'),
      bug('P3 (Medium)', ['Production']),
    ];
    const row = computeQualityRow(bugs, bugs.map(() => true));
    expect(row).toEqual({ totalBugs: 4, critical: 2, major: 1, minor: 1, prodBug: 2, noRC: 0 });
  });

  it('counts bugs with no RC keyword found in their fetched text', () => {
    const bugs = [bug('P1 (Highest)'), bug('P2 (High)'), bug('P3 (Medium)')];
    const row = computeQualityRow(bugs, [true, false, false]);
    expect(row.noRC).toBe(2);
  });

  it('returns all zeros for an empty bug list', () => {
    expect(computeQualityRow([], [])).toEqual({ totalBugs: 0, critical: 0, major: 0, minor: 0, prodBug: 0, noRC: 0 });
  });
});
