import { describe, it, expect } from 'vitest';
import {
  hasImpactAnalysisKeyword,
  computeImpactAnalysisRow,
  prefillMissingImpactTable,
} from '../src/sprint-report-impact-analysis.js';
import type { JiraIssue } from '../src/jira-client.js';

function issue(key: string): JiraIssue {
  return {
    key,
    project: 'PC',
    summary: '',
    status: 'Ready for Testing',
    priority: null,
    labels: [],
    storyPoints: null,
    productDomain: null,
    bugEnvironments: [],
  };
}

describe('hasImpactAnalysisKeyword', () => {
  it('matches a standalone "IA" acronym, case-insensitively', () => {
    expect(hasImpactAnalysisKeyword('See IA notes below')).toBe(true);
    expect(hasImpactAnalysisKeyword('see ia notes below')).toBe(true);
  });

  it('does not match "ia" embedded inside an unrelated word', () => {
    expect(hasImpactAnalysisKeyword('This material change is special')).toBe(false);
  });

  it('matches the multi-word phrases "Technical Impact" and "Impact Analysis"', () => {
    expect(hasImpactAnalysisKeyword('Technical Impact: none')).toBe(true);
    expect(hasImpactAnalysisKeyword('impact analysis done')).toBe(true);
  });

  it('returns false when none of the keywords are present', () => {
    expect(hasImpactAnalysisKeyword('Just a normal description')).toBe(false);
  });
});

describe('computeImpactAnalysisRow', () => {
  it('splits results into good and missing counts', () => {
    expect(computeImpactAnalysisRow([true, false, true])).toEqual({
      totalTickets: 3,
      iaGood: 2,
      iaMissingInfo: 1,
    });
  });
});

describe('prefillMissingImpactTable', () => {
  it('lists only tickets missing the IA keyword, with blank manual info', () => {
    const rows = prefillMissingImpactTable([issue('A'), issue('B')], [true, false]);
    expect(rows).toEqual([{ ticket: 'B', missingInfo: '' }]);
  });
});
