import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ApiAutomationPage } from '../../src/components/ApiAutomationPage';
import type { FormState } from '../../src/types';

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

function sourceFor(jobId: string): MockEventSource {
  const source = MockEventSource.instances.find((s) => s.url === `/runs/${jobId}/events`);
  if (!source) {
    throw new Error(`No EventSource opened for job "${jobId}"`);
  }
  return source;
}

function makeGrpcForm(service: string, method: string, taskName: string): FormState {
  return {
    actorName: '',
    taskName,
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
      service,
      method,
      requestMessage: '{}',
      metadata: [],
      secure: true,
      skipCertVerification: false,
    },
    extracts: [],
    questions: [],
    kafkaCheck: { enabled: false, topic: 'transLogV1' },
    kafkaContractCheck: { enabled: false, topic: 'transLogV1', version: '' },
    afterResponse: [],
  };
}

function makeRestForm(taskName: string): FormState {
  return {
    actorName: '',
    taskName,
    variables: [],
    protocol: 'rest',
    method: 'GET',
    url: 'https://example.com',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    grpc: {
      protoContent: '',
      protoFilename: '',
      serverAddress: '',
      service: '',
      method: '',
      requestMessage: '',
      metadata: [],
      secure: true,
      skipCertVerification: false,
    },
    extracts: [],
    questions: [],
    kafkaCheck: { enabled: false, topic: 'transLogV1' },
    kafkaContractCheck: { enabled: false, topic: 'transLogV1', version: '' },
    afterResponse: [],
  };
}

const STEPS: Record<string, FormState> = {
  'grpc step A': makeGrpcForm('PaymentService', 'CreatePayment', 'Task A'),
  'grpc step B': makeGrpcForm('UserProfile', 'QueryByPhone', 'Task B'),
  'grpc step D': makeGrpcForm('UserProfile', 'UpdateProfile', 'Task D'),
  'rest step C': makeRestForm('Task C'),
};

const FLOWS: Record<string, string[]> = {
  'Flow One': ['grpc step A', 'grpc step D'],
  'Flow Two': ['grpc step D'],
};

const JOB_IDS: Record<string, string> = {
  'Task A': 'job-a',
  'Task B': 'job-b',
  'Task D': 'job-d',
};

function stubFetch() {
  return vi.fn((url: string, init?: RequestInit) => {
    if (url.startsWith('/steps/')) {
      const name = decodeURIComponent(url.replace('/steps/', ''));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(STEPS[name]) });
    }
    if (url.startsWith('/flows/')) {
      const name = decodeURIComponent(url.replace('/flows/', ''));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(FLOWS[name] ?? []) });
    }
    if (url === '/runs' && init?.method === 'POST') {
      const body = JSON.parse(init.body as string) as { tasks: { name: string }[] };
      const taskName = body.tasks[0].name;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobId: JOB_IDS[taskName] }) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
}

const STEP_NAMES = Object.keys(STEPS);
const FLOW_NAMES = Object.keys(FLOWS);

function renderPage(onFormChange = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={['/api-automation']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route
          path="/api-automation"
          element={<ApiAutomationPage stepNames={STEP_NAMES} flowNames={FLOW_NAMES} onFormChange={onFormChange} />}
        />
        <Route path="/" element={<div>Landed on Simple Mode</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ApiAutomationPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists only gRPC steps, excluding REST steps', async () => {
    vi.stubGlobal('fetch', stubFetch());
    renderPage();

    expect(await screen.findByRole('button', { name: /grpc step A/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /grpc step B/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /grpc step D/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rest step C/ })).not.toBeInTheDocument();
  });

  it('shows correct flow membership badges', async () => {
    vi.stubGlobal('fetch', stubFetch());
    renderPage();

    expect(await screen.findByRole('button', { name: /grpc step A/ })).toHaveTextContent('Flow One');
    expect(screen.getByRole('button', { name: /grpc step B/ })).toHaveTextContent('—');
    expect(screen.getByRole('button', { name: /grpc step D/ })).toHaveTextContent('Flow One, Flow Two');
  });

  it('filters by Service', async () => {
    vi.stubGlobal('fetch', stubFetch());
    renderPage();
    await screen.findByRole('button', { name: /grpc step A/ });

    await userEvent.type(screen.getByLabelText('Service'), 'Payment');

    expect(screen.getByRole('button', { name: /grpc step A/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /grpc step B/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /grpc step D/ })).not.toBeInTheDocument();
  });

  it('narrows Method suggestions to the selected Service', async () => {
    vi.stubGlobal('fetch', stubFetch());
    const { container } = renderPage();
    await screen.findByRole('button', { name: /grpc step A/ });

    await userEvent.type(screen.getByLabelText('Service'), 'UserProfile');

    const methodOptions = Array.from(
      container.querySelectorAll('#api-automation-method-options option')
    ).map((option) => option.getAttribute('value'));
    expect(methodOptions.sort()).toEqual(['QueryByPhone', 'UpdateProfile']);
  });

  it('filters by E2E flow', async () => {
    vi.stubGlobal('fetch', stubFetch());
    renderPage();
    await screen.findByRole('button', { name: /grpc step A/ });

    await userEvent.type(screen.getByLabelText('E2E flow'), 'Flow Two');

    expect(screen.getByRole('button', { name: /grpc step D/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /grpc step A/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /grpc step B/ })).not.toBeInTheDocument();
  });

  it('loads the clicked step into the form and navigates to Simple Mode', async () => {
    const onFormChange = vi.fn();
    vi.stubGlobal('fetch', stubFetch());
    renderPage(onFormChange);

    await userEvent.click(await screen.findByRole('button', { name: /grpc step A/ }));

    expect(onFormChange).toHaveBeenCalledWith(STEPS['grpc step A']);
    expect(await screen.findByText('Landed on Simple Mode')).toBeInTheDocument();
  });

  it('starts one independent job per filtered step when Run is clicked, not a combined flow', async () => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    const fetchMock = stubFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByRole('button', { name: /grpc step A/ });

    await userEvent.type(screen.getByLabelText('Service'), 'UserProfile');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await vi.waitFor(() => expect(MockEventSource.instances.length).toBe(2));
    const runsCalls = fetchMock.mock.calls.filter(([url]) => url === '/runs');
    expect(runsCalls).toHaveLength(2);
    for (const [, init] of runsCalls) {
      const body = JSON.parse((init as RequestInit).body as string) as { tasks: unknown[] };
      expect(body.tasks).toHaveLength(1);
    }
  });

  it('shows independent Passed/Failed status per step — one failing does not block another', async () => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('fetch', stubFetch());
    renderPage();
    await screen.findByRole('button', { name: /grpc step A/ });

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    await vi.waitFor(() => expect(MockEventSource.instances.length).toBe(3));

    sourceFor('job-a').emit({
      type: 'step:failed',
      index: 0,
      result: { type: 'interaction', runner: 'grpc', action: 'call', status: 'failed', args: {}, error: 'boom' },
    });
    sourceFor('job-a').emit({ type: 'run:failed', error: 'boom' });

    sourceFor('job-b').emit({
      type: 'step:completed',
      index: 0,
      result: { type: 'interaction', runner: 'grpc', action: 'call', status: 'passed', args: {} },
    });
    sourceFor('job-b').emit({
      type: 'step:completed',
      index: 1,
      result: {
        type: 'extract',
        runner: 'grpc',
        action: 'raw',
        status: 'passed',
        actual: { status: 0, headers: {}, body: {} },
      },
    });
    sourceFor('job-b').emit({ type: 'run:completed' });

    expect(await screen.findByText(/grpc step A.*failed/)).toBeInTheDocument();
    expect(await screen.findByText(/grpc step B.*passed/)).toBeInTheDocument();
  });

  it('expands a result row to show its response detail', async () => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('fetch', stubFetch());
    renderPage();
    await screen.findByRole('button', { name: /grpc step A/ });

    await userEvent.type(screen.getByLabelText('Service'), 'PaymentService');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    await vi.waitFor(() => expect(MockEventSource.instances.length).toBe(1));

    sourceFor('job-a').emit({
      type: 'step:completed',
      index: 0,
      result: { type: 'interaction', runner: 'grpc', action: 'call', status: 'passed', args: {} },
    });
    sourceFor('job-a').emit({
      type: 'step:completed',
      index: 1,
      result: {
        type: 'extract',
        runner: 'grpc',
        action: 'raw',
        status: 'passed',
        actual: { status: 0, headers: {}, body: { ok: true } },
      },
    });
    sourceFor('job-a').emit({ type: 'run:completed' });

    const row = await screen.findByText(/grpc step A.*passed/);
    await userEvent.click(row);
    expect(await screen.findByText('Status: 0')).toBeInTheDocument();
  });

  it('clears the results list when a filter changes after Run', async () => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('fetch', stubFetch());
    renderPage();
    await screen.findByRole('button', { name: /grpc step A/ });

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    await vi.waitFor(() => expect(MockEventSource.instances.length).toBe(3));
    expect(screen.getByText(/grpc step A.*pending/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Method'), 'Create');

    expect(screen.queryByText(/grpc step A.*pending/)).not.toBeInTheDocument();
    expect(screen.getByText('No flow run yet.')).toBeInTheDocument();
  });

  it('disables Run when no steps match the current filters', async () => {
    vi.stubGlobal('fetch', stubFetch());
    renderPage();
    await screen.findByRole('button', { name: /grpc step A/ });

    await userEvent.type(screen.getByLabelText('Service'), 'NoSuchService');

    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('disables Run while a run is already in progress', async () => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('fetch', stubFetch());
    renderPage();
    await screen.findByRole('button', { name: /grpc step A/ });

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('still loads a step into Simple Mode via row click after a completed Run', async () => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    const onFormChange = vi.fn();
    vi.stubGlobal('fetch', stubFetch());
    renderPage(onFormChange);
    await screen.findByRole('button', { name: /grpc step A/ });

    await userEvent.type(screen.getByLabelText('Service'), 'PaymentService');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    await vi.waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    sourceFor('job-a').emit({ type: 'run:completed' });
    await screen.findByText(/grpc step A.*pending/);

    // After Run, both the row list and the results list contain a button whose
    // accessible name includes "grpc step A" — scope to the row list container
    // to click the row-list one specifically (the results-list one is a
    // different, unrelated button rendered by FlowResultsPanel).
    const rowList = document.querySelector('.step-browser-list') as HTMLElement;
    await userEvent.click(within(rowList).getByRole('button', { name: /grpc step A/ }));

    expect(onFormChange).toHaveBeenCalledWith(STEPS['grpc step A']);
    expect(await screen.findByText('Landed on Simple Mode')).toBeInTheDocument();
  });
});
