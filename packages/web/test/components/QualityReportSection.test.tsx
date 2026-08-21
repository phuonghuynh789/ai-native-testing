import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
      noRC: 'https://jira.example.com/issues/?jql=noRC',
    },
    impactAnalysis: { totalTickets: 0, iaGood: 0, iaMissingInfo: 0 },
    impactAnalysisJiraLinks: { iaGood: '', iaMissingInfo: '' },
    sandboxDateBreakdown: {
      ticketsInSprint: 0,
      ticketsCreatedMidSprint: 0,
      missingSandboxDate: 0,
      sandboxDateEqualsSprintEnd: 0,
      sandboxDateMinus1: 0,
      sandboxDatePlus1: 0,
      sandboxDatePlus2: 0,
    },
    sandboxDateJiraLinks: { ticketsInSprint: '', createdMidSprint: '', missingSandboxDate: '', equalsSprintEnd: '', minus1: '', plus1: '', plus2: '' },
    executiveSummary: { delivery: 'unset', quality: 'unset', impactAnalysis: 'unset', overall: 'unset', commentary: '' },
    ...overrides,
  };
}

describe('QualityReportSection', () => {
  it('renders the auto-computed bug counts, including No RC', () => {
    render(<QualityReportSection rows={[row()]} qualityComment="" onQualityCommentChange={() => {}} />);
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('22')).toBeInTheDocument();
    expect(screen.getByText('No RC')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('links each bug count to its Jira issue search', () => {
    render(<QualityReportSection rows={[row()]} qualityComment="" onQualityCommentChange={() => {}} />);
    expect(screen.getByText('25').closest('a')).toHaveAttribute('href', 'https://jira.example.com/issues/?jql=totalBugs');
    expect(screen.getByText('3').closest('a')).toHaveAttribute('href', 'https://jira.example.com/issues/?jql=major');
    expect(screen.getByText('22').closest('a')).toHaveAttribute('href', 'https://jira.example.com/issues/?jql=minor');
  });

  it('links No RC to its approximate Jira text-search result', () => {
    render(<QualityReportSection rows={[row()]} qualityComment="" onQualityCommentChange={() => {}} />);
    expect(screen.getByText('7').closest('a')).toHaveAttribute('href', 'https://jira.example.com/issues/?jql=noRC');
  });

  it('calls onQualityCommentChange when the Nhận xét textarea changes', async () => {
    const onQualityCommentChange = vi.fn();
    render(<QualityReportSection rows={[row()]} qualityComment="" onQualityCommentChange={onQualityCommentChange} />);
    await userEvent.type(screen.getByLabelText('Nhận xét'), 'x');
    expect(onQualityCommentChange).toHaveBeenCalledWith('x');
  });

  it('shows detailed Vietnamese commentary suggestions below the Nhận xét field', () => {
    render(<QualityReportSection rows={[row()]} qualityComment="" onQualityCommentChange={() => {}} />);
    const list = screen.getByRole('list');
    expect(list).toHaveTextContent('Root Cause (No RC)');
    expect(list).toHaveTextContent('Prod Bug');
    expect(list.querySelectorAll('li')).toHaveLength(4);
  });
});
