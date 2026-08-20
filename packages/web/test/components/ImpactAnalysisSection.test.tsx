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
    deliveryJiraLinks: { committed: '', delivered: '', readyForTest: '', new: '' },
    quality: { totalBugs: 0, critical: 0, major: 0, minor: 0, prodBug: 0 },
    qualityJiraLinks: { totalBugs: '', critical: '', major: '', minor: '', prodBug: '' },
    impactAnalysis: { totalTickets: 10, iaGood: 8, iaMissingInfo: 2 },
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
    missingImpact: [{ ticket: 'PC-100', missingInfo: '' }],
    executiveSummary: { delivery: 'unset', quality: 'unset', impactAnalysis: 'unset', overall: 'unset', commentary: '' },
    ...overrides,
  };
}

describe('ImpactAnalysisSection', () => {
  it('renders the auto-computed IA counts and the prefilled missing-impact ticket', () => {
    render(<ImpactAnalysisSection rows={[row()]} onRowsChange={() => {}} />);
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('PC-100')).toBeInTheDocument();
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

  it('calls onRowsChange when a missing-info cell is edited', async () => {
    const onRowsChange = vi.fn();
    render(<ImpactAnalysisSection rows={[row()]} onRowsChange={onRowsChange} />);
    await userEvent.type(screen.getByLabelText('PC-100 missing info'), 'x');
    const updatedRows = onRowsChange.mock.calls[0][0] as SprintReportRowData[];
    expect(updatedRows[0].missingImpact[0].missingInfo).toBe('x');
  });
});
