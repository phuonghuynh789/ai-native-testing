import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExecutiveSummarySection } from '../../src/components/ExecutiveSummarySection';
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
    quality: { totalBugs: 0, critical: 0, major: 0, minor: 0, prodBug: 0, noRC: 0 },
    qualityJiraLinks: { totalBugs: '', critical: '', major: '', minor: '', prodBug: '', noRC: '' },
    impactAnalysis: { totalTickets: 0, iaGood: 0, iaMissingInfo: 0 },
    impactAnalysisJiraLinks: { iaGood: '', iaMissingInfo: '' },
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

describe('ExecutiveSummarySection', () => {
  it('calls onRowsChange when the Overall picker changes', async () => {
    const onRowsChange = vi.fn();
    render(<ExecutiveSummarySection rows={[row()]} onRowsChange={onRowsChange} />);
    await userEvent.selectOptions(screen.getByLabelText('PC executive overall'), 'good');
    const updatedRows = onRowsChange.mock.calls[0][0] as SprintReportRowData[];
    expect(updatedRows[0].executiveSummary.overall).toBe('good');
  });

  it('calls onRowsChange when the commentary textarea changes', async () => {
    const onRowsChange = vi.fn();
    render(<ExecutiveSummarySection rows={[row()]} onRowsChange={onRowsChange} />);
    await userEvent.type(screen.getByLabelText('PC commentary'), 'x');
    const updatedRows = onRowsChange.mock.calls[0][0] as SprintReportRowData[];
    expect(updatedRows[0].executiveSummary.commentary).toBe('x');
  });

  it('shows a Vietnamese commentary hint', () => {
    render(<ExecutiveSummarySection rows={[row()]} onRowsChange={() => {}} />);
    expect(screen.getByText(/Gợi ý/)).toBeInTheDocument();
  });
});
