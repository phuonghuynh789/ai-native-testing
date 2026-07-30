import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FlowResultsPanel, type TaskResult } from '../../src/components/FlowResultsPanel';

function taskResult(overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    name: 'Check Balance',
    status: 'passed',
    results: { response: { status: 200, headers: {}, body: {} }, savedValues: {}, context: {}, logs: [] },
    ...overrides,
  };
}

describe('FlowResultsPanel', () => {
  it('shows a placeholder when no flow has run yet', () => {
    render(<FlowResultsPanel taskResults={null} />);
    expect(screen.getByText('No flow run yet.')).toBeInTheDocument();
  });

  it('renders one row per task with its name and status', () => {
    render(
      <FlowResultsPanel
        taskResults={[
          taskResult({ name: 'Check Balance' }),
          taskResult({ name: 'Transfer Money', status: 'failed' }),
        ]}
      />
    );
    expect(screen.getByText(/Check Balance.*passed/)).toBeInTheDocument();
    expect(screen.getByText(/Transfer Money.*failed/)).toBeInTheDocument();
  });

  it('expands a row to show its full response and collapses on a second click', async () => {
    render(<FlowResultsPanel taskResults={[taskResult()]} />);
    expect(screen.queryByText('Status: 200')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText(/Check Balance.*passed/));
    expect(screen.getByText('Status: 200')).toBeInTheDocument();

    await userEvent.click(screen.getByText(/Check Balance.*passed/));
    expect(screen.queryByText('Status: 200')).not.toBeInTheDocument();
  });
});
