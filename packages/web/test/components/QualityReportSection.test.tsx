import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QualityReportSection } from '../../src/components/QualityReportSection';
import type { SprintReportRowData } from '../../src/sprintReports';

function row(overrides: Partial<SprintReportRowData> = {}): SprintReportRowData {
  return {
    rowKey: 'PC',
    delivery: {
      committedTickets: 0,
      committedSP: 0,
      deliveredTickets: 0,
      deliveredSP: 0,
      readyForTestTickets: 0,
      readyForTestSP: 0,
      predictability: null,
      predictabilityRFT: null,
      newTickets: 0,
      newSP: 0,
      predictabilityNew: null,
    },
    deliveryJiraLinks: { committed: '', delivered: '', readyForTest: '', new: '' },
    quality: { totalBugs: 25, critical: 0, major: 3, minor: 22, prodBug: 0, noRC: 7 },
    qualityJiraLinks: {
      totalBugs: 'https://jira.example.com/issues/?jql=totalBugs',
      critical: 'https://jira.example.com/issues/?jql=critical',
      major: 'https://jira.example.com/issues/?jql=major',
      minor: 'https://jira.example.com/issues/?jql=minor',
      prodBug: 'https://jira.example.com/issues/?jql=prodBug',
    },
    impactAnalysis: { totalTickets: 0, iaGood: 0, iaMissingInfo: 0 },
    iaWrongScope: 0,
    sandboxDateBreakdown: {
      readyOrInTestTickets: 0,
      missingSandboxDate: 0,
      sandboxDateEqualsSprintEnd: 0,
      sandboxDateMinus1: 0,
      sandboxDatePlus1: 0,
      sandboxDatePlus2: 0,
    },
    sandboxDateJiraLinks: { readyOrInTest: '', missingSandboxDate: '', equalsSprintEnd: '', minus1: '', plus1: '', plus2: '' },
    executiveSummary: { delivery: 'unset', quality: 'unset', impactAnalysis: 'unset', overall: 'unset', commentary: '' },
    ...overrides,
  };
}

describe('QualityReportSection', () => {
  it('renders the auto-computed bug counts, including No RC', () => {
    render(<QualityReportSection rows={[row()]} />);
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('22')).toBeInTheDocument();
    expect(screen.getByText('No RC')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('links each bug count to its Jira issue search', () => {
    render(<QualityReportSection rows={[row()]} />);
    expect(screen.getByText('25').closest('a')).toHaveAttribute('href', 'https://jira.example.com/issues/?jql=totalBugs');
    expect(screen.getByText('3').closest('a')).toHaveAttribute('href', 'https://jira.example.com/issues/?jql=major');
    expect(screen.getByText('22').closest('a')).toHaveAttribute('href', 'https://jira.example.com/issues/?jql=minor');
  });

  it('does not link No RC, since it is not a native Jira field filter', () => {
    render(<QualityReportSection rows={[row()]} />);
    expect(screen.getByText('7').closest('a')).toBeNull();
  });
});
