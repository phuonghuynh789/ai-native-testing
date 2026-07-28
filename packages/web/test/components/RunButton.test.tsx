import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunButton } from '../../src/components/RunButton';
import type { FormState } from '../../src/types';

function emptyForm(): FormState {
  return {
    actorName: 'Actor',
    taskName: 'Task',
    variables: [],
    method: 'GET',
    url: 'https://api.example.com',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    extracts: [],
    questions: [],
  };
}

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

describe('RunButton', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('POSTs the assembled definition and opens an EventSource for the returned jobId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) });
    vi.stubGlobal('fetch', fetchMock);

    const onRunStart = vi.fn();
    render(
      <RunButton
        form={emptyForm()}
        disabled={false}
        onRunStart={onRunStart}
        onEvent={() => {}}
        onError={() => {}}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(onRunStart).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('/runs', expect.objectContaining({ method: 'POST' }));
    expect(MockEventSource.instances[0]?.url).toBe('/runs/job-1/events');
  });

  it('forwards each SSE event via onEvent and closes on run:completed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) }));
    const onEvent = vi.fn();
    render(
      <RunButton form={emptyForm()} disabled={false} onRunStart={() => {}} onEvent={onEvent} onError={() => {}} />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    const source = MockEventSource.instances[0];
    source.emit({ type: 'step:started', index: 0, step: {} });
    source.emit({ type: 'run:completed' });

    expect(onEvent).toHaveBeenCalledWith({ type: 'step:started', index: 0, step: {} });
    expect(onEvent).toHaveBeenCalledWith({ type: 'run:completed' });
    expect(source.closed).toBe(true);
  });

  it('calls onError when POST /runs fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ errors: ['bad'] }) })
    );
    const onError = vi.fn();
    render(
      <RunButton form={emptyForm()} disabled={false} onRunStart={() => {}} onEvent={() => {}} onError={onError} />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Could not start run'));
  });

  it('is disabled when the disabled prop is true', () => {
    render(<RunButton form={emptyForm()} disabled onRunStart={() => {}} onEvent={() => {}} onError={() => {}} />);
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });
});
