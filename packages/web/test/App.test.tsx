import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    if (url === '/actors' || url === '/tasks' || url === '/steps' || url === '/flows' || url === '/kafka-checks') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    return Promise.resolve(runsResponse);
  });
}

describe('App', () => {
  beforeEach(() => {
    // App renders a real BrowserRouter, which reads/writes window.history —
    // a global that RTL's cleanup() does not reset between tests. Without
    // this, a navigation in one test leaks into the next test's initial URL.
    window.history.pushState({}, '', '/');
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
    expect(screen.getByRole('heading', { name: 'Simple Mode' })).toBeInTheDocument();
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

  it('switches between Simple Mode and End-to-end test via the sidebar', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Simple Mode' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'End-to-end test' }));
    expect(screen.getByRole('heading', { name: 'End-to-end test' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Simple Mode' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Task')).not.toBeInTheDocument();
  });

  it('preserves in-progress Simple Mode form state after navigating away and back', async () => {
    render(<App />);
    await userEvent.type(screen.getByLabelText('Task'), 'Create Payment');

    await userEvent.click(screen.getByRole('link', { name: 'End-to-end test' }));
    await userEvent.click(screen.getByRole('link', { name: 'Simple Mode' }));

    expect(screen.getByLabelText('Task')).toHaveValue('Create Payment');
  });

  it('navigates to API Automation, filters to a step, and loads it into Simple Mode', async () => {
    const savedSteps: Record<string, unknown> = {
      'grpc step A': {
        actorName: '',
        taskName: 'Grpc Task A',
        variables: [],
        protocol: 'grpc',
        method: 'GET',
        url: '',
        params: [],
        headers: [],
        auth: { type: 'none' },
        body: '',
        grpc: {
          protoContent: 'syntax = "proto3";',
          protoFilename: 'service.proto',
          serverAddress: 'localhost:50051',
          service: 'PaymentService',
          method: 'CreatePayment',
          requestMessage: '{}',
          metadata: [],
          secure: true,
          skipCertVerification: false,
        },
        extracts: [],
        questions: [],
        kafkaCheck: { enabled: false, topic: 'transLogV1' },
        afterResponse: [],
      },
    };
    const savedFlows: Record<string, string[]> = { 'Flow One': ['grpc step A'] };

    const fetchMock = vi.fn((url: string) => {
      if (url === '/actors' || url === '/tasks') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url === '/steps') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(Object.keys(savedSteps)) });
      }
      if (url === '/flows') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(Object.keys(savedFlows)) });
      }
      if (url.startsWith('/steps/')) {
        const name = decodeURIComponent(url.replace('/steps/', ''));
        return Promise.resolve({ ok: true, json: () => Promise.resolve(savedSteps[name]) });
      }
      if (url.startsWith('/flows/')) {
        const name = decodeURIComponent(url.replace('/flows/', ''));
        return Promise.resolve({ ok: true, json: () => Promise.resolve(savedFlows[name] ?? []) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await userEvent.click(screen.getByRole('link', { name: 'API Automation' }));
    expect(screen.getByRole('heading', { name: 'API Automation' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Service'), 'Payment');
    await userEvent.click(await screen.findByRole('button', { name: /grpc step A/ }));

    expect(screen.getByRole('heading', { name: 'Simple Mode' })).toBeInTheDocument();
    expect(screen.getByLabelText('Task')).toHaveValue('Grpc Task A');
  });

  it('switches to Check Kafka via the sidebar', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('link', { name: 'Check Kafka' }));
    expect(screen.getByRole('heading', { name: 'Check Kafka' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Simple Mode' })).not.toBeInTheDocument();
  });

  it('registers a Kafka check when Check Kafka is enabled and Run is clicked', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/actors' || url === '/tasks' || url === '/steps' || url === '/flows' || url === '/kafka-checks') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await userEvent.type(screen.getByLabelText('Task'), 'Create Payment');
    await userEvent.type(screen.getByLabelText('URL'), 'https://api.example.com/v1/payments');
    await userEvent.click(screen.getByRole('button', { name: 'Body' }));
    fireEvent.change(screen.getByLabelText('Body (JSON)'), { target: { value: '{"appTransID":"tx-999"}' } });
    await userEvent.click(screen.getByLabelText('Check Kafka'));

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(fetchMock).toHaveBeenCalledWith('/kafka-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: 'tx-999', name: 'Create Payment', topic: 'transLogV1' }),
    });
  });
});
