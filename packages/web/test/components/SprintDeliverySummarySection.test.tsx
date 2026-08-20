import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SprintDeliverySummarySection } from '../../src/components/SprintDeliverySummarySection';
import type { SprintReportRowData } from '../../src/sprintReports';

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
    quality: { totalBugs: 0, critical: 0, major: 0, minor: 0, prodBug: 0 },
    impactAnalysis: { totalTickets: 0, iaGood: 0, iaMissingInfo: 0 },
    qualityChecklist: {
      noCriticalBug: 'unset',
      noProductionBug: 'unset',
      reopenRateUnder10: 'unset',
      uatStable: 'unset',
      assessment: 'unset',
    },
    iaWrongScope: 0,
    rootCause: [{ ticket: 'PC-1', sandboxDate: '2026-08-15', reason: '', owner: '', action: '' }],
    missingImpact: [],
    executiveSummary: { delivery: 'unset', quality: 'unset', impactAnalysis: 'unset', overall: 'unset', commentary: '' },
    ...overrides,
  };
}

describe('SprintDeliverySummarySection', () => {
  it('renders committed/delivered/ready-for-test numbers and predictability as a percentage', () => {
    render(
      <SprintDeliverySummarySection
        rows={[row()]}
        onRowsChange={() => {}}
        deliveryComment=""
        onDeliveryCommentChange={() => {}}
      />
    );
    expect(screen.getByText('80')).toBeInTheDocument();
    expect(screen.getByText('70')).toBeInTheDocument();
    expect(screen.getByText('87.5%')).toBeInTheDocument();
  });

  it('renders New Tickets/SP and the Predictability RFT/New percentages', () => {
    render(
      <SprintDeliverySummarySection
        rows={[row()]}
        onRowsChange={() => {}}
        deliveryComment=""
        onDeliveryCommentChange={() => {}}
      />
    );
    expect(screen.getByText('93.8%')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('18.8%')).toBeInTheDocument();
  });

  it('shows a dash for every predictability variant when committed SP is 0', () => {
    render(
      <SprintDeliverySummarySection
        rows={[
          row({
            delivery: {
              ...row().delivery,
              committedSP: 0,
              predictability: null,
              predictabilityRFT: null,
              predictabilityNew: null,
            },
          }),
        ]}
        onRowsChange={() => {}}
        deliveryComment=""
        onDeliveryCommentChange={() => {}}
      />
    );
    expect(screen.getAllByText('—')).toHaveLength(3);
  });

  it('calls onDeliveryCommentChange when the Nhận xét textarea changes', async () => {
    const onDeliveryCommentChange = vi.fn();
    render(
      <SprintDeliverySummarySection
        rows={[row()]}
        onRowsChange={() => {}}
        deliveryComment=""
        onDeliveryCommentChange={onDeliveryCommentChange}
      />
    );
    await userEvent.type(screen.getByLabelText('Nhận xét'), 'x');
    expect(onDeliveryCommentChange).toHaveBeenCalledWith('x');
  });

  it('renders the Sandbox Date column in the Root Cause table', () => {
    render(
      <SprintDeliverySummarySection
        rows={[row()]}
        onRowsChange={() => {}}
        deliveryComment=""
        onDeliveryCommentChange={() => {}}
      />
    );
    expect(screen.getByText('Sandbox Date')).toBeInTheDocument();
    expect(screen.getByText('2026-08-15')).toBeInTheDocument();
  });

  it('calls onRowsChange with an updated reason when a root cause reason is edited', async () => {
    const onRowsChange = vi.fn();
    render(
      <SprintDeliverySummarySection
        rows={[row()]}
        onRowsChange={onRowsChange}
        deliveryComment=""
        onDeliveryCommentChange={() => {}}
      />
    );
    await userEvent.type(screen.getByLabelText('PC-1 reason'), 'x');
    const updatedRows = onRowsChange.mock.calls[0][0] as SprintReportRowData[];
    expect(updatedRows[0].rootCause[0].reason).toBe('x');
  });
});
