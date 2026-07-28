import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResultsPanel } from '../../src/components/ResultsPanel';
import type { DerivedResults } from '../../src/results';

const sampleResults: DerivedResults = {
  response: { status: 201, headers: { 'content-type': 'application/json' }, body: { data: { paymentId: 'pay_1' } } },
  savedValues: { paymentId: 'pay_1' },
  context: { baseUrl: 'https://api.example.com', paymentId: 'pay_1' },
  logs: ['interaction request → passed', 'question status → passed'],
};

describe('ResultsPanel', () => {
  it('shows a placeholder before any run has happened', () => {
    render(<ResultsPanel results={null} />);
    expect(screen.getByText('No run yet.')).toBeInTheDocument();
  });

  it('shows the response status by default', () => {
    render(<ResultsPanel results={sampleResults} />);
    expect(screen.getByText('Status: 201')).toBeInTheDocument();
  });

  it('switches to the Saved Values tab', async () => {
    render(<ResultsPanel results={sampleResults} />);
    await userEvent.click(screen.getByRole('button', { name: 'Saved Values' }));
    expect(screen.getByText(/paymentId/)).toBeInTheDocument();
  });

  it('switches to the Logs tab', async () => {
    render(<ResultsPanel results={sampleResults} />);
    await userEvent.click(screen.getByRole('button', { name: 'Logs' }));
    expect(screen.getByText('interaction request → passed')).toBeInTheDocument();
  });
});
