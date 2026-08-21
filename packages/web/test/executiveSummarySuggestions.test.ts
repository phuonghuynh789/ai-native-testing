import { describe, it, expect } from 'vitest';
import {
  assessDelivery,
  assessQuality,
  assessImpactAnalysis,
  assessOverall,
  suggestExecutiveSummary,
} from '../src/executiveSummarySuggestions';
import type { SprintReportRowData } from '../src/sprintReports';

function row(overrides: Partial<SprintReportRowData> = {}): SprintReportRowData {
  return {
    rowKey: 'PC',
    delivery: {
      committedTickets: 10,
      committedSP: 80,
      deliveredTickets: 8,
      deliveredSP: 70,
      readyForTestTickets: 9,
      readyForTestSP: 75,
      predictability: 0.875,
      predictabilityRFT: 0.9375,
      newTickets: 3,
      newSP: 15,
      predictabilityNew: 0.1875,
    },
    deliveryJiraLinks: { committed: '', delivered: '', readyForTest: '', new: '' },
    quality: { totalBugs: 25, critical: 0, major: 0, minor: 22, prodBug: 0, noRC: 0 },
    qualityJiraLinks: { totalBugs: '', critical: '', major: '', minor: '', prodBug: '', noRC: '' },
    impactAnalysis: { totalTickets: 10, iaGood: 10, iaMissingInfo: 0 },
    impactAnalysisJiraLinks: { iaGood: '', iaMissingInfo: '' },
    sandboxDateBreakdown: {
      ticketsInSprint: 0,
      missingSandboxDate: 0,
      sandboxDateEqualsSprintEnd: 0,
      sandboxDateMinus1: 0,
      sandboxDatePlus1: 0,
      sandboxDatePlus2: 0,
    },
    sandboxDateJiraLinks: { ticketsInSprint: '', missingSandboxDate: '', equalsSprintEnd: '', minus1: '', plus1: '', plus2: '' },
    executiveSummary: { delivery: 'unset', quality: 'unset', impactAnalysis: 'unset', overall: 'unset', commentary: '' },
    ...overrides,
  };
}

describe('assessDelivery', () => {
  it('is good when Predictability is at least 80%', () => {
    expect(assessDelivery(row({ delivery: { ...row().delivery, predictability: 0.8 } }))).toBe('good');
    expect(assessDelivery(row({ delivery: { ...row().delivery, predictability: 0.875 } }))).toBe('good');
  });

  it('is bad when Predictability is below 80%', () => {
    expect(assessDelivery(row({ delivery: { ...row().delivery, predictability: 0.79 } }))).toBe('bad');
  });

  it('is null when Predictability is null (no committed SP)', () => {
    expect(assessDelivery(row({ delivery: { ...row().delivery, predictability: null } }))).toBeNull();
  });
});

describe('assessQuality', () => {
  it('is good when there are no Critical, Major, or Prod bugs', () => {
    expect(assessQuality(row({ quality: { totalBugs: 5, critical: 0, major: 0, minor: 5, prodBug: 0, noRC: 0 } }))).toBe(
      'good'
    );
  });

  it('is bad when there is a Critical bug', () => {
    expect(assessQuality(row({ quality: { totalBugs: 1, critical: 1, major: 0, minor: 0, prodBug: 0, noRC: 0 } }))).toBe(
      'bad'
    );
  });

  it('is bad when there is a Major bug', () => {
    expect(assessQuality(row({ quality: { totalBugs: 1, critical: 0, major: 1, minor: 0, prodBug: 0, noRC: 0 } }))).toBe(
      'bad'
    );
  });

  it('is bad when there is a Prod Bug', () => {
    expect(assessQuality(row({ quality: { totalBugs: 1, critical: 0, major: 0, minor: 0, prodBug: 1, noRC: 0 } }))).toBe(
      'bad'
    );
  });
});

describe('assessImpactAnalysis', () => {
  it('is good when there is no IA Missing Info', () => {
    expect(assessImpactAnalysis(row({ impactAnalysis: { totalTickets: 10, iaGood: 10, iaMissingInfo: 0 } }))).toBe(
      'good'
    );
  });

  it('is partial when the Missing Info ratio is 20% or below', () => {
    expect(assessImpactAnalysis(row({ impactAnalysis: { totalTickets: 10, iaGood: 8, iaMissingInfo: 2 } }))).toBe(
      'partial'
    );
  });

  it('is bad when the Missing Info ratio is above 20%', () => {
    expect(assessImpactAnalysis(row({ impactAnalysis: { totalTickets: 10, iaGood: 7, iaMissingInfo: 3 } }))).toBe(
      'bad'
    );
  });

  it('is null when there are no Ready-for-Test tickets to assess', () => {
    expect(assessImpactAnalysis(row({ impactAnalysis: { totalTickets: 0, iaGood: 0, iaMissingInfo: 0 } }))).toBeNull();
  });
});

describe('assessOverall', () => {
  it('is bad when any available indicator is bad', () => {
    expect(assessOverall('good', 'bad', 'partial')).toBe('bad');
    expect(assessOverall('bad', null, null)).toBe('bad');
  });

  it('is good when every available indicator is good', () => {
    expect(assessOverall('good', 'good', 'good')).toBe('good');
    expect(assessOverall('good', 'good', null)).toBe('good');
  });

  it('is partial when indicators are mixed but none are bad', () => {
    expect(assessOverall('good', 'good', 'partial')).toBe('partial');
  });

  it('is null when no indicator has data', () => {
    expect(assessOverall(null, null, null)).toBeNull();
  });
});

describe('suggestExecutiveSummary', () => {
  it('pre-fills unset Delivery/Quality/Impact Analysis/Overall from the computed assessment', () => {
    const suggested = suggestExecutiveSummary(row());
    expect(suggested.executiveSummary.delivery).toBe('good');
    expect(suggested.executiveSummary.quality).toBe('good');
    expect(suggested.executiveSummary.impactAnalysis).toBe('good');
    expect(suggested.executiveSummary.overall).toBe('good');
  });

  it('does not overwrite an indicator the user (or a prior save) already set', () => {
    const withManualDelivery = row({
      executiveSummary: { delivery: 'bad', quality: 'unset', impactAnalysis: 'unset', overall: 'unset', commentary: '' },
    });
    const suggested = suggestExecutiveSummary(withManualDelivery);
    expect(suggested.executiveSummary.delivery).toBe('bad');
  });

  it('computes Overall from the final (post-suggestion) Delivery/Quality/Impact Analysis values', () => {
    const withBadQuality = row({
      quality: { totalBugs: 1, critical: 1, major: 0, minor: 0, prodBug: 0, noRC: 0 },
    });
    const suggested = suggestExecutiveSummary(withBadQuality);
    expect(suggested.executiveSummary.quality).toBe('bad');
    expect(suggested.executiveSummary.overall).toBe('bad');
  });

  it('leaves an indicator unset when there is no data to assess it', () => {
    const noCommitted = row({ delivery: { ...row().delivery, predictability: null } });
    const suggested = suggestExecutiveSummary(noCommitted);
    expect(suggested.executiveSummary.delivery).toBe('unset');
  });
});
