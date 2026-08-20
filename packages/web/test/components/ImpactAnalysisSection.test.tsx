import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImpactAnalysisSection } from '../../src/components/ImpactAnalysisSection';
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
    deliveryJiraLinks: {
      committed: '',
      delivered: '',
      readyForTest: 'https://jira.example.com/issues/?jql=readyForTest',
      new: '',
    },
    quality: { totalBugs: 0, critical: 0, major: 0, minor: 0, prodBug: 0, noRC: 0 },
    qualityJiraLinks: { totalBugs: '', critical: '', major: '', minor: '', prodBug: '', noRC: '' },
    impactAnalysis: { totalTickets: 10, iaGood: 8, iaMissingInfo: 2 },
    impactAnalysisJiraLinks: {
      iaGood: 'https://jira.example.com/issues/?jql=iaGood',
      iaMissingInfo: 'https://jira.example.com/issues/?jql=iaMissingInfo',
    },
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

describe('ImpactAnalysisSection', () => {
  it('renders the auto-computed IA counts', () => {
    render(<ImpactAnalysisSection rows={[row()]} />);
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('links Total Tickets to the same Jira search as Ready for Test Tickets', () => {
    render(<ImpactAnalysisSection rows={[row()]} />);
    expect(screen.getByText('10').closest('a')).toHaveAttribute(
      'href',
      'https://jira.example.com/issues/?jql=readyForTest'
    );
  });

  it('links IA Good and IA Missing Info to their approximate Jira text-search results', () => {
    render(<ImpactAnalysisSection rows={[row()]} />);
    expect(screen.getByText('8').closest('a')).toHaveAttribute('href', 'https://jira.example.com/issues/?jql=iaGood');
    expect(screen.getByText('2').closest('a')).toHaveAttribute(
      'href',
      'https://jira.example.com/issues/?jql=iaMissingInfo'
    );
  });
});
