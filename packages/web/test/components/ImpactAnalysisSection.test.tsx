import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    qualityJiraLinks: { totalBugs: '', critical: '', major: '', minor: '', prodBug: '' },
    impactAnalysis: { totalTickets: 10, iaGood: 8, iaMissingInfo: 2 },
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

describe('ImpactAnalysisSection', () => {
  it('renders the auto-computed IA counts', () => {
    render(<ImpactAnalysisSection rows={[row()]} onRowsChange={() => {}} />);
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('links Total Tickets to the same Jira search as Ready for Test Tickets', () => {
    render(<ImpactAnalysisSection rows={[row()]} onRowsChange={() => {}} />);
    expect(screen.getByText('10').closest('a')).toHaveAttribute(
      'href',
      'https://jira.example.com/issues/?jql=readyForTest'
    );
  });

  it('calls onRowsChange when IA Wrong Scope is edited', async () => {
    const onRowsChange = vi.fn();
    render(<ImpactAnalysisSection rows={[row()]} onRowsChange={onRowsChange} />);
    const input = screen.getByLabelText('PC IA Wrong Scope');
    await userEvent.clear(input);
    await userEvent.type(input, '3');
    const updatedRows = onRowsChange.mock.calls[onRowsChange.mock.calls.length - 1][0] as SprintReportRowData[];
    expect(updatedRows[0].iaWrongScope).toBe(3);
  });
});
