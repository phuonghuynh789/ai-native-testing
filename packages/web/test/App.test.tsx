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

function stubNameListFetch(runsResponse: unknown = { ok: false, json: () => Promise.resolve({}) }) {
  return vi.fn((url: string) => {
    if (url === '/actors' || url === '/tasks' || url === '/steps') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    return Promise.resolve(runsResponse);
  });
}

describe('App', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('fetch', stubNameListFetch());
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
    vi.stubGlobal(
      'fetch',
      stubNameListFetch({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) })
    );

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

  it('saves a new Actor/Task name via POST when Run is clicked', async () => {
    const fetchMock = stubNameListFetch({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await userEvent.type(screen.getByLabelText('Actor'), 'Authenticated Customer');
    await userEvent.type(screen.getByLabelText('Task'), 'Create Payment');
    await userEvent.type(screen.getByLabelText('URL'), 'https://api.example.com/v1/payments');

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(fetchMock).toHaveBeenCalledWith('/actors', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith('/tasks', expect.objectContaining({ method: 'POST' }));
  });

  it('saves a step and can load it back into the form', async () => {
    const savedSteps: Record<string, unknown> = {};
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/actors' || url === '/tasks') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url === '/steps' && !init) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(Object.keys(savedSteps)) });
      }
      if (url === '/steps' && init?.method === 'POST') {
        const { name, content } = JSON.parse(init.body as string);
        savedSteps[name] = content;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ names: Object.keys(savedSteps) }),
        });
      }
      if (url.startsWith('/steps/')) {
        const name = decodeURIComponent(url.replace('/steps/', ''));
        return Promise.resolve({ ok: true, json: () => Promise.resolve(savedSteps[name]) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'prompt').mockReturnValue('Create Payment');
    vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(<App />);

    await userEvent.type(screen.getByLabelText('Task'), 'Create Payment');
    await userEvent.type(screen.getByLabelText('URL'), 'https://api.example.com/v1/payments');

    await userEvent.click(screen.getByRole('button', { name: 'Save as Reusable Step' }));
    expect(window.alert).toHaveBeenCalledWith('Saved "Create Payment".');

    await userEvent.clear(screen.getByLabelText('Task'));
    expect(screen.getByLabelText('Task')).toHaveValue('');

    await userEvent.selectOptions(screen.getByLabelText('Load Reusable Step'), 'Create Payment');

    await vi.waitFor(() => expect(screen.getByLabelText('Task')).toHaveValue('Create Payment'));
    expect(screen.getByLabelText('URL')).toHaveValue('https://api.example.com/v1/payments');
  });
});
