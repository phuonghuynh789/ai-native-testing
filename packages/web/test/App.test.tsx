import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  close() {
    this.closed = true;
  }
}

describe('App', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the page heading', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { name: 'API Runner — REST (Simple Mode)' })
    ).toBeInTheDocument();
  });

  it('disables Run until Task name and URL are filled in', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('runs a full flow: fills the form, submits, and shows the response from a live event', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await userEvent.type(screen.getByLabelText('Task'), 'Create Payment');
    await userEvent.type(screen.getByLabelText('URL'), 'https://api.example.com/v1/payments');

    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    const source = MockEventSource.instances[0];
    source.emit({
      type: 'step:completed',
      index: 0,
      result: { type: 'interaction', runner: 'rest', action: 'request', status: 'passed', args: {} },
    });
    source.emit({
      type: 'step:completed',
      index: 1,
      result: {
        type: 'extract',
        runner: 'rest',
        action: 'raw',
        status: 'passed',
        actual: { status: 201, headers: {}, body: { data: { paymentId: 'pay_1' } } },
      },
    });
    source.emit({ type: 'run:completed' });

    expect(await screen.findByText('Status: 201')).toBeInTheDocument();
  });
});
