import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    method: 'GET',
    url: 'https://api.example.com/balance',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    extracts: [],
    questions: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FlowRunner', () => {
  it('disables Run Flow until a flow is selected', () => {
    render(<FlowRunner flowNames={['Transfer money by wallet']} />);
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

    render(<FlowRunner flowNames={['Transfer money by wallet']} />);
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'Transfer money by wallet');
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

    render(<FlowRunner flowNames={['Balance Only']} />);
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'Balance Only');
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
});
