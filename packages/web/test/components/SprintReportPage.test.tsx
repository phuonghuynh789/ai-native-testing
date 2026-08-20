import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SprintReportPage } from '../../src/components/SprintReportPage';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function sampleReportResponse() {
  return {
    sprintCode: '26.08.B',
    startDate: '2026/08/06',
    endDate: '2026/08/19',
    labels: ['nhuvth'],
    rows: [
      {
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
        quality: { totalBugs: 25, critical: 0, major: 3, minor: 22, prodBug: 0 },
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
        missingImpact: [],
        executiveSummary: { delivery: 'unset', quality: 'unset', impactAnalysis: 'unset', overall: 'unset', commentary: '' },
      },
    ],
    deliveryComment: '',
    createdAt: '',
    updatedAt: '',
  };
}

describe('SprintReportPage', () => {
  it('generates a report and renders all 4 sections', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(sampleReportResponse()) }));
    render(<SprintReportPage />);

    await userEvent.type(screen.getByLabelText('Sprint Code'), '26.08.B');
    await userEvent.type(screen.getByLabelText('Start Date'), '2026/08/06');
    await userEvent.type(screen.getByLabelText('End Date'), '2026/08/19');
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(await screen.findByText('1. Sprint Delivery Summary')).toBeInTheDocument();
    expect(screen.getByText('2. Quality Report')).toBeInTheDocument();
    expect(screen.getByText('3. Impact Analysis Review')).toBeInTheDocument();
    expect(screen.getByText('4. Executive Summary (Quan trọng nhất)')).toBeInTheDocument();
  });

  it('offers the Sprint Code field as a filterable dropdown of known sprint codes', () => {
    render(<SprintReportPage />);
    const input = screen.getByLabelText('Sprint Code');
    expect(input).toHaveAttribute('list');
    const listId = input.getAttribute('list')!;
    const datalist = document.getElementById(listId) as HTMLDataListElement;
    const optionValues = Array.from(datalist.options).map((option) => option.value);
    expect(optionValues).toContain('26.08.B');
    expect(optionValues).toContain('26.01.A');
    expect(optionValues).toContain('26.12.B');
    expect(optionValues).toHaveLength(26);
  });

  it('shows an error when Generate fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({ error: 'Jira is not configured' }) })
    );
    render(<SprintReportPage />);

    await userEvent.type(screen.getByLabelText('Sprint Code'), '26.08.B');
    await userEvent.type(screen.getByLabelText('Start Date'), '2026/08/06');
    await userEvent.type(screen.getByLabelText('End Date'), '2026/08/19');
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Jira is not configured');
  });

  it('loads a previously saved report via Load Saved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(sampleReportResponse()) }));
    render(<SprintReportPage />);

    await userEvent.type(screen.getByLabelText('Sprint Code'), '26.08.B');
    await userEvent.click(screen.getByRole('button', { name: 'Load Saved' }));

    expect(await screen.findByText('1. Sprint Delivery Summary')).toBeInTheDocument();
    expect(screen.getByLabelText('Start Date')).toHaveValue('2026/08/06');
  });

  it('saves the current report via Save', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(sampleReportResponse()) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SprintReportPage />);

    await userEvent.type(screen.getByLabelText('Sprint Code'), '26.08.B');
    await userEvent.type(screen.getByLabelText('Start Date'), '2026/08/06');
    await userEvent.type(screen.getByLabelText('End Date'), '2026/08/19');
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await screen.findByText('1. Sprint Delivery Summary');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(fetchMock).toHaveBeenCalledWith('/sprint-reports/26.08.B', expect.objectContaining({ method: 'PUT' }));
  });
});
