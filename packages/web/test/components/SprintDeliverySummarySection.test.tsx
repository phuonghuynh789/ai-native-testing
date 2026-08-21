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
    deliveryJiraLinks: {
      committed: 'https://jira.example.com/issues/?jql=committed',
      delivered: 'https://jira.example.com/issues/?jql=delivered',
      readyForTest: 'https://jira.example.com/issues/?jql=readyForTest',
      new: 'https://jira.example.com/issues/?jql=new',
    },
    quality: { totalBugs: 0, critical: 0, major: 0, minor: 0, prodBug: 0, noRC: 0 },
    qualityJiraLinks: { totalBugs: '', critical: '', major: '', minor: '', prodBug: '', noRC: '' },
    impactAnalysis: { totalTickets: 0, iaGood: 0, iaMissingInfo: 0 },
    impactAnalysisJiraLinks: { iaGood: '', iaMissingInfo: '' },
    sandboxDateBreakdown: {
      readyOrInTestTickets: 20,
      missingSandboxDate: 5,
      sandboxDateEqualsSprintEnd: 6,
      sandboxDateMinus1: 7,
      sandboxDatePlus1: 11,
      sandboxDatePlus2: 13,
    },
    sandboxDateJiraLinks: {
      readyOrInTest: 'https://jira.example.com/issues/?jql=readyOrInTest',
      missingSandboxDate: 'https://jira.example.com/issues/?jql=missingSandboxDate',
      equalsSprintEnd: 'https://jira.example.com/issues/?jql=equalsSprintEnd',
      minus1: 'https://jira.example.com/issues/?jql=minus1',
      plus1: 'https://jira.example.com/issues/?jql=plus1',
      plus2: 'https://jira.example.com/issues/?jql=plus2',
    },
    executiveSummary: { delivery: 'unset', quality: 'unset', impactAnalysis: 'unset', overall: 'unset', commentary: '' },
    ...overrides,
  };
}

describe('SprintDeliverySummarySection', () => {
  it('renders committed/delivered/ready-for-test numbers and predictability as a percentage', () => {
    render(
      <SprintDeliverySummarySection
        rows={[row()]}
        deliveryComment=""
        onDeliveryCommentChange={() => {}}
      />
    );
    expect(screen.getByText('80')).toBeInTheDocument();
    expect(screen.getByText('70')).toBeInTheDocument();
    expect(screen.getByText('87.5%')).toBeInTheDocument();
  });

  it('links each ticket/SP count to its Jira issue search', () => {
    render(
      <SprintDeliverySummarySection
        rows={[row()]}
        deliveryComment=""
        onDeliveryCommentChange={() => {}}
      />
    );
    expect(screen.getByText('10').closest('a')).toHaveAttribute(
      'href',
      'https://jira.example.com/issues/?jql=committed'
    );
    expect(screen.getByText('8').closest('a')).toHaveAttribute(
      'href',
      'https://jira.example.com/issues/?jql=delivered'
    );
    expect(screen.getByText('9').closest('a')).toHaveAttribute(
      'href',
      'https://jira.example.com/issues/?jql=readyForTest'
    );
    expect(screen.getByText('3').closest('a')).toHaveAttribute('href', 'https://jira.example.com/issues/?jql=new');
  });

  it('renders New Tickets/SP and the Predictability RFT/New percentages', () => {
    render(
      <SprintDeliverySummarySection
        rows={[row()]}
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
        deliveryComment=""
        onDeliveryCommentChange={onDeliveryCommentChange}
      />
    );
    await userEvent.type(screen.getByLabelText('Nhận xét'), 'x');
    expect(onDeliveryCommentChange).toHaveBeenCalledWith('x');
  });

  it('shows a Vietnamese commentary hint below the Nhận xét field', () => {
    render(
      <SprintDeliverySummarySection rows={[row()]} deliveryComment="" onDeliveryCommentChange={() => {}} />
    );
    expect(screen.getByText(/Gợi ý/)).toBeInTheDocument();
  });

  it('renders the Root Cause Tickets Trễ Sandbox Date breakdown per squad', () => {
    render(
      <SprintDeliverySummarySection
        rows={[row()]}
        deliveryComment=""
        onDeliveryCommentChange={() => {}}
      />
    );
    expect(screen.getByText('Root Cause Tickets Trễ')).toBeInTheDocument();
    expect(screen.getByText('Ready for Testing or In Test Tickets')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('Sandbox Date = Close Sprint')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('Sandbox Date - 1')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('Sandbox Date + 1')).toBeInTheDocument();
    expect(screen.getByText('11')).toBeInTheDocument();
    expect(screen.getByText('Sandbox Date + 2')).toBeInTheDocument();
    expect(screen.getByText('13')).toBeInTheDocument();
  });

  it('links each Sandbox Date breakdown count to its Jira issue search', () => {
    render(
      <SprintDeliverySummarySection
        rows={[row()]}
        deliveryComment=""
        onDeliveryCommentChange={() => {}}
      />
    );
    expect(screen.getByText('20').closest('a')).toHaveAttribute(
      'href',
      'https://jira.example.com/issues/?jql=readyOrInTest'
    );
    expect(screen.getByText('5').closest('a')).toHaveAttribute(
      'href',
      'https://jira.example.com/issues/?jql=missingSandboxDate'
    );
    expect(screen.getByText('6').closest('a')).toHaveAttribute(
      'href',
      'https://jira.example.com/issues/?jql=equalsSprintEnd'
    );
    expect(screen.getByText('7').closest('a')).toHaveAttribute('href', 'https://jira.example.com/issues/?jql=minus1');
    expect(screen.getByText('11').closest('a')).toHaveAttribute('href', 'https://jira.example.com/issues/?jql=plus1');
    expect(screen.getByText('13').closest('a')).toHaveAttribute('href', 'https://jira.example.com/issues/?jql=plus2');
  });
});
