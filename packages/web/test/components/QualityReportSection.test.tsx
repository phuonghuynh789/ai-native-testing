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
    quality: { totalBugs: 25, critical: 0, major: 3, minor: 22, prodBug: 0 },
    qualityJiraLinks: {
      totalBugs: 'https://jira.example.com/issues/?jql=totalBugs',
      critical: 'https://jira.example.com/issues/?jql=critical',
      major: 'https://jira.example.com/issues/?jql=major',
      minor: 'https://jira.example.com/issues/?jql=minor',
      prodBug: 'https://jira.example.com/issues/?jql=prodBug',
    },
    impactAnalysis: { totalTickets: 0, iaGood: 0, iaMissingInfo: 0 },
    qualityChecklist: {
      noCriticalBug: 'unset',
      noProductionBug: 'unset',
      reopenRateUnder10: 'unset',
      uatStable: 'unset',
      assessment: 'unset',
    },
    iaWrongScope: 0,
    sandboxDateBreakdown: {
      readyOrInTestTickets: 0,
      missingSandboxDate: 0,
      sandboxDateEqualsSprintEnd: 0,
      sandboxDateMinus1: 0,
      sandboxDatePlus1: 0,
      sandboxDatePlus2: 0,
    },
    missingImpact: [],
    executiveSummary: { delivery: 'unset', quality: 'unset', impactAnalysis: 'unset', overall: 'unset', commentary: '' },
    ...overrides,
  };
}

describe('QualityReportSection', () => {
  it('renders the auto-computed bug counts', () => {
    render(<QualityReportSection rows={[row()]} onRowsChange={() => {}} />);
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('22')).toBeInTheDocument();
  });

  it('links each bug count to its Jira issue search', () => {
    render(<QualityReportSection rows={[row()]} onRowsChange={() => {}} />);
    expect(screen.getByText('25').closest('a')).toHaveAttribute('href', 'https://jira.example.com/issues/?jql=totalBugs');
    expect(screen.getByText('3').closest('a')).toHaveAttribute('href', 'https://jira.example.com/issues/?jql=major');
    expect(screen.getByText('22').closest('a')).toHaveAttribute('href', 'https://jira.example.com/issues/?jql=minor');
  });

  it('calls onRowsChange when the assessment select changes', async () => {
    const onRowsChange = vi.fn();
    render(<QualityReportSection rows={[row()]} onRowsChange={onRowsChange} />);
    await userEvent.selectOptions(screen.getByLabelText('PC assessment'), 'good');
    const updatedRows = onRowsChange.mock.calls[0][0] as SprintReportRowData[];
    expect(updatedRows[0].qualityChecklist.assessment).toBe('good');
  });

  it('calls onRowsChange when a Quality Rating checklist item changes', async () => {
    const onRowsChange = vi.fn();
    render(<QualityReportSection rows={[row()]} onRowsChange={onRowsChange} />);
    await userEvent.selectOptions(screen.getByLabelText('PC noCriticalBug'), 'pass');
    const updatedRows = onRowsChange.mock.calls[0][0] as SprintReportRowData[];
    expect(updatedRows[0].qualityChecklist.noCriticalBug).toBe('pass');
  });
});
