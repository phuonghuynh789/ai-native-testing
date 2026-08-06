import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FlowRunner } from '../../src/components/FlowRunner';
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

function sampleForm(overrides: Partial<FormState> = {}): FormState {
  return {
    actorName: 'Authenticated Customer',
    taskName: 'Check Balance',
    variables: [],
    protocol: 'rest',
    method: 'GET',
    url: 'https://api.example.com/balance',
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
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FlowRunner', () => {
  it('disables Save Flow and Run Flow while Flow Order is empty', () => {
    render(
      <FlowRunner
        flowNames={['Transfer money by wallet']}
        onFlowNamesChange={vi.fn()}
        stepNames={['Check Balance']}
      />
    );
    expect(screen.getByRole('button', { name: 'Save Flow' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run Flow' })).toBeDisabled();
  });

  it('runs a two-step flow and shows a passed checklist row per task', async () => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);

    const stepA = sampleForm({ taskName: 'Check Balance', url: 'https://api.example.com/balance' });
    const stepB = sampleForm({ taskName: 'Transfer Money', url: 'https://api.example.com/transfer' });

    const fetchMock = vi.fn((url: string) => {
      if (url === '/flows/Transfer%20money%20by%20wallet') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(['Check Balance', 'Transfer Money']),
        });
      }
      if (url === '/steps/Check%20Balance') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(stepA) });
      }
      if (url === '/steps/Transfer%20Money') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(stepB) });
      }
      if (url === '/runs') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FlowRunner
        flowNames={['Transfer money by wallet']}
        onFlowNamesChange={vi.fn()}
        stepNames={['Check Balance', 'Transfer Money']}
      />
    );
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'Transfer money by wallet');
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Run Flow' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Run Flow' }));

    await vi.waitFor(() => expect(MockEventSource.instances.length).toBe(1));
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
        actual: { status: 200, headers: {}, body: {} },
      },
    });
    source.emit({
      type: 'step:completed',
      index: 2,
      result: { type: 'interaction', runner: 'rest', action: 'request', status: 'passed', args: {} },
    });
    source.emit({
      type: 'step:completed',
      index: 3,
      result: {
        type: 'extract',
        runner: 'rest',
        action: 'raw',
        status: 'passed',
        actual: { status: 201, headers: {}, body: {} },
      },
    });
    source.emit({ type: 'run:completed' });

    expect(await screen.findByText(/Check Balance.*passed/)).toBeInTheDocument();
    expect(await screen.findByText(/Transfer Money.*passed/)).toBeInTheDocument();
  });

  it('expands a task row to show its full response', async () => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);

    const stepA = sampleForm({ taskName: 'Check Balance' });

    const fetchMock = vi.fn((url: string) => {
      if (url === '/flows/Balance%20Only') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(['Check Balance']) });
      }
      if (url === '/steps/Check%20Balance') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(stepA) });
      }
      if (url === '/runs') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FlowRunner flowNames={['Balance Only']} onFlowNamesChange={vi.fn()} stepNames={['Check Balance']} />
    );
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'Balance Only');
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Run Flow' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Run Flow' }));

    await vi.waitFor(() => expect(MockEventSource.instances.length).toBe(1));
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
        actual: { status: 200, headers: {}, body: { balance: 100 } },
      },
    });
    source.emit({ type: 'run:completed' });

    const row = await screen.findByText(/Check Balance.*passed/);
    await userEvent.click(row);
    expect(await screen.findByText('Status: 200')).toBeInTheDocument();
  });

  it('populates Flow Order (and removes those steps from Available) when an existing flow is selected', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/flows/Transfer%20money%20by%20wallet') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(['Check Balance', 'Transfer Money']),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FlowRunner
        flowNames={['Transfer money by wallet']}
        onFlowNamesChange={vi.fn()}
        stepNames={['Check Balance', 'Transfer Money', 'Get User']}
      />
    );
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'Transfer money by wallet');

    await vi.waitFor(() => expect(screen.getByText('Check Balance')).toBeInTheDocument());
    expect(screen.getByText('Transfer Money')).toBeInTheDocument();
    expect(screen.getByText('Get User')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run Flow' })).toBeEnabled();
  });

  it('saves the current flow order via Save Flow and reports the updated flow names', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/flows/My%20New%20Flow' && init?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ names: ['My New Flow'] }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onFlowNamesChange = vi.fn();

    render(<FlowRunner flowNames={[]} onFlowNamesChange={onFlowNamesChange} stepNames={['Check Balance']} />);

    await userEvent.selectOptions(screen.getByLabelText('Flow'), '__new_flow__');
    await userEvent.type(screen.getByLabelText('New flow name'), 'My New Flow');

    fireEvent.dragStart(screen.getByText('Check Balance'));
    fireEvent.dragOver(screen.getByText('Drop here to add'));
    fireEvent.drop(screen.getByText('Drop here to add'));

    await userEvent.click(screen.getByRole('button', { name: 'Save Flow' }));

    expect(fetchMock).toHaveBeenCalledWith('/flows/My%20New%20Flow', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepNames: ['Check Balance'] }),
    });
    await vi.waitFor(() => expect(onFlowNamesChange).toHaveBeenCalledWith(['My New Flow']));
  });

  it('runs the current (possibly reordered) flow order, not the originally loaded order', async () => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);

    const stepA = sampleForm({ taskName: 'Check Balance', url: 'https://api.example.com/balance' });
    const stepB = sampleForm({ taskName: 'Transfer Money', url: 'https://api.example.com/transfer' });
    let capturedRunsBody = '';

    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/flows/Transfer%20money%20by%20wallet') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(['Check Balance', 'Transfer Money']),
        });
      }
      if (url === '/steps/Check%20Balance') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(stepA) });
      }
      if (url === '/steps/Transfer%20Money') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(stepB) });
      }
      if (url === '/runs') {
        capturedRunsBody = init?.body as string;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FlowRunner
        flowNames={['Transfer money by wallet']}
        onFlowNamesChange={vi.fn()}
        stepNames={['Check Balance', 'Transfer Money']}
      />
    );
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'Transfer money by wallet');
    await vi.waitFor(() => expect(screen.getByText('Transfer Money')).toBeInTheDocument());

    // Reorder: drag "Transfer Money" (loaded 2nd) to land before "Check Balance" (loaded 1st).
    fireEvent.dragStart(screen.getByText('Transfer Money'));
    fireEvent.dragOver(screen.getByText('Check Balance'));
    fireEvent.drop(screen.getByText('Check Balance'));

    await userEvent.click(screen.getByRole('button', { name: 'Run Flow' }));

    await vi.waitFor(() => expect(capturedRunsBody).not.toBe(''));
    const definition = JSON.parse(capturedRunsBody) as { tasks: { name: string }[] };
    expect(definition.tasks.map((t) => t.name)).toEqual(['Transfer Money', 'Check Balance']);
  });
});
