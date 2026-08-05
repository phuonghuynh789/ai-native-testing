# API Automation "Run" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Run" button to the API Automation page that executes every currently-filtered gRPC step as its own independent request and shows a Passed/Failed status per step, with response detail available on click.

**Architecture:** `ApiAutomationPage` fires one independent `POST /runs` + `EventSource` per filtered step (never combined into one multi-task flow, since the engine's dispatcher is fail-fast and would let one failing step block every later one) and streams each step's own status into a `TaskResult[]`, rendered via the existing, unmodified `FlowResultsPanel`.

**Tech Stack:** React 18, TypeScript, `@ai-native-testing/engine` (`RunEvent`, `StepResult` types), Vitest + React Testing Library + `@testing-library/user-event`.

## Global Constraints

- Run executes only `filteredEntries` (the currently-filtered/visible rows) — never every saved gRPC step regardless of filter.
- Each filtered step runs as its own independent `TestDefinition` (`buildTestDefinition(entry.form)`, the same one-task builder the existing Simple Mode "Run" button already uses) with its own `/runs` job and `EventSource` — steps are never combined into one `buildFlowDefinition` call.
- All steps run concurrently (fired together, not queued).
- Results reuse `FlowResultsPanel`/`TaskResult` (`packages/web/src/components/FlowResultsPanel.tsx`) completely unmodified — no new results-rendering component.
- A `TaskResult`'s `name` is the saved step's own name (`entry.name`, e.g. `"gRPC CreatePayment step"`) — the same identifier already shown in the row list above — not `entry.form.taskName`.
- Changing any filter (Service, Method, or E2E flow) clears `taskResults` back to `null`.
- The existing row list's click-to-load-into-Simple-Mode behavior is unchanged — it must still work exactly as before, including after a Run has completed.
- No backend changes. No changes to `FlowResultsPanel.tsx`, `ResultsPanel.tsx`, `dsl.ts`, or `results.ts`.

---

### Task 1: Add Run button with per-step independent execution and results

**Files:**
- Modify: `packages/web/src/components/ApiAutomationPage.tsx`
- Modify: `packages/web/test/components/ApiAutomationPage.test.tsx`

**Interfaces:**
- Consumes: `buildTestDefinition(form: FormState): TestDefinition` and `buildTaskSteps(form: FormState): Step[]` from `../dsl` (existing, unchanged). `deriveResults(extracts: ExtractRow[], variables: Record<string,string>, stepResults: (StepResult|undefined)[]): DerivedResults` from `../results` (existing, unchanged). `FlowResultsPanel` and its exported `TaskResult` type (`{ name: string; status: 'pending'|'passed'|'failed'; results: DerivedResults }`) from `./FlowResultsPanel` (existing, unchanged). `RunEvent`, `StepResult` types from `@ai-native-testing/engine` (existing, unchanged — see `packages/web/src/components/FlowRunner.tsx` for the identical existing usage pattern this task mirrors).
- Produces: nothing new for later tasks — this is the final piece of the API Automation Run feature.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `packages/web/test/components/ApiAutomationPage.test.tsx` with:

```tsx
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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm --filter @ai-native-testing/web test -- ApiAutomationPage.test.tsx`
Expected: the 6 pre-existing tests still PASS; the 7 new Run-related tests FAIL (no "Run" button exists yet).

- [ ] **Step 3: Implement the Run feature**

Replace the full contents of `packages/web/src/components/ApiAutomationPage.tsx` with:

```tsx
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RunEvent, StepResult } from '@ai-native-testing/engine';
import type { FormState } from '../types';
import { fetchStep } from '../steps';
import { fetchFlow } from '../flows';
import { buildTestDefinition, buildTaskSteps } from '../dsl';
import { deriveResults } from '../results';
import { FlowResultsPanel, type TaskResult } from './FlowResultsPanel';

export interface ApiAutomationPageProps {
  stepNames: string[];
  flowNames: string[];
  onFormChange: Dispatch<SetStateAction<FormState>>;
}

interface GrpcStepEntry {
  name: string;
  form: FormState;
  flows: string[];
}

function matches(value: string, filter: string): boolean {
  return value.toLowerCase().includes(filter.toLowerCase());
}

function toVariablesRecord(form: FormState): Record<string, string> {
  return Object.fromEntries(
    form.variables.filter((row) => row.key.trim() !== '').map((row) => [row.key, row.value])
  );
}

export function ApiAutomationPage({ stepNames, flowNames, onFormChange }: ApiAutomationPageProps) {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<GrpcStepEntry[]>([]);
  const [serviceFilter, setServiceFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [flowFilter, setFlowFilter] = useState('');
  const [taskResults, setTaskResults] = useState<TaskResult[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const fetchedSteps = await Promise.all(
        stepNames.map(async (name) => ({ name, form: await fetchStep(name) }))
      );
      const fetchedFlows = await Promise.all(
        flowNames.map(async (flowName) => ({ flowName, stepsInFlow: (await fetchFlow(flowName)) ?? [] }))
      );

      if (cancelled) {
        return;
      }

      const grpcEntries = fetchedSteps
        .filter((step): step is { name: string; form: FormState } => step.form?.protocol === 'grpc')
        .map(({ name, form }) => ({
          name,
          form,
          flows: fetchedFlows.filter(({ stepsInFlow }) => stepsInFlow.includes(name)).map(({ flowName }) => flowName),
        }));

      setEntries(grpcEntries);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [stepNames, flowNames]);

  const serviceOptions = Array.from(new Set(entries.map((entry) => entry.form.grpc.service))).filter(Boolean);
  const methodOptions = Array.from(
    new Set(
      entries
        .filter((entry) => matches(entry.form.grpc.service, serviceFilter))
        .map((entry) => entry.form.grpc.method)
    )
  ).filter(Boolean);

  const filteredEntries = entries.filter(
    (entry) =>
      matches(entry.form.grpc.service, serviceFilter) &&
      matches(entry.form.grpc.method, methodFilter) &&
      (flowFilter === '' || entry.flows.some((flowName) => matches(flowName, flowFilter)))
  );

  const isRunning = taskResults !== null && taskResults.some((result) => result.status === 'pending');

  function handleRowClick(entry: GrpcStepEntry) {
    onFormChange(entry.form);
    navigate('/');
  }

  function updateTaskResult(index: number, result: TaskResult) {
    setTaskResults((prev) => {
      if (!prev) {
        return prev;
      }
      const next = [...prev];
      next[index] = result;
      return next;
    });
  }

  function runEntry(entry: GrpcStepEntry, index: number) {
    const variablesRecord = toVariablesRecord(entry.form);
    const totalSteps = buildTaskSteps(entry.form).length;
    const stepResults: (StepResult | undefined)[] = [];

    function recompute() {
      const completedCount = stepResults.filter((result) => result !== undefined).length;
      let status: TaskResult['status'] = 'pending';
      if (completedCount === totalSteps) {
        status = stepResults.every((result) => result?.status === 'passed') ? 'passed' : 'failed';
      } else if (stepResults.some((result) => result?.status === 'failed')) {
        status = 'failed';
      }
      updateTaskResult(index, {
        name: entry.name,
        status,
        results: deriveResults(entry.form.extracts, variablesRecord, stepResults),
      });
    }

    async function start() {
      let jobId: string;
      try {
        const response = await fetch('/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildTestDefinition(entry.form)),
        });
        if (!response.ok) {
          updateTaskResult(index, {
            name: entry.name,
            status: 'failed',
            results: deriveResults(entry.form.extracts, variablesRecord, []),
          });
          return;
        }
        const body = (await response.json()) as { jobId: string };
        jobId = body.jobId;
      } catch {
        updateTaskResult(index, {
          name: entry.name,
          status: 'failed',
          results: deriveResults(entry.form.extracts, variablesRecord, []),
        });
        return;
      }

      const source = new EventSource(`/runs/${jobId}/events`);
      source.onmessage = (message) => {
        const event = JSON.parse(message.data) as RunEvent;
        if (event.type === 'step:completed' || event.type === 'step:failed') {
          stepResults[event.index] = event.result;
          recompute();
        }
        if (event.type === 'run:completed' || event.type === 'run:failed') {
          source.close();
        }
      };
      source.onerror = () => {
        source.close();
      };
    }

    start();
  }

  function handleRun() {
    setTaskResults(
      filteredEntries.map((entry) => ({
        name: entry.name,
        status: 'pending',
        results: deriveResults(entry.form.extracts, toVariablesRecord(entry.form), []),
      }))
    );
    filteredEntries.forEach((entry, index) => runEntry(entry, index));
  }

  return (
    <main className="app-main">
      <h1 className="heading-xl">API Automation</h1>
      <div className="row">
        <label className="label">
          Service
          <input
            className="text-input"
            list="api-automation-service-options"
            value={serviceFilter}
            onChange={(e) => {
              setServiceFilter(e.target.value);
              setTaskResults(null);
            }}
          />
          <datalist id="api-automation-service-options">
            {serviceOptions.map((service) => (
              <option key={service} value={service} />
            ))}
          </datalist>
        </label>
        <label className="label">
          Method
          <input
            className="text-input"
            list="api-automation-method-options"
            value={methodFilter}
            onChange={(e) => {
              setMethodFilter(e.target.value);
              setTaskResults(null);
            }}
          />
          <datalist id="api-automation-method-options">
            {methodOptions.map((method) => (
              <option key={method} value={method} />
            ))}
          </datalist>
        </label>
        <label className="label">
          E2E flow
          <input
            className="text-input"
            list="api-automation-flow-options"
            value={flowFilter}
            onChange={(e) => {
              setFlowFilter(e.target.value);
              setTaskResults(null);
            }}
          />
          <datalist id="api-automation-flow-options">
            {flowNames.map((flowName) => (
              <option key={flowName} value={flowName} />
            ))}
          </datalist>
        </label>
      </div>
      <div className="row">
        <button
          type="button"
          className="btn-primary"
          disabled={filteredEntries.length === 0 || isRunning}
          onClick={handleRun}
        >
          Run
        </button>
      </div>
      <ul className="step-browser-list">
        {filteredEntries.map((entry) => (
          <li key={entry.name}>
            <button type="button" className="step-browser-row" onClick={() => handleRowClick(entry)}>
              <span className="step-browser-name">{entry.name}</span>
              <span className="step-browser-meta">
                {entry.form.grpc.service} / {entry.form.grpc.method}
              </span>
              <span className="step-browser-flows">{entry.flows.length > 0 ? entry.flows.join(', ') : '—'}</span>
            </button>
          </li>
        ))}
      </ul>
      <FlowResultsPanel taskResults={taskResults} />
    </main>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- ApiAutomationPage.test.tsx`
Expected: PASS (14 tests)

- [ ] **Step 5: Run the full web test suite and typecheck**

Run: `pnpm --filter @ai-native-testing/web test`
Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: PASS / no errors

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/ApiAutomationPage.tsx packages/web/test/components/ApiAutomationPage.test.tsx
git commit -m "feat(web): add Run button to API Automation with independent per-step results"
```

---

## Final Verification

1. Run `pnpm test` and `pnpm typecheck` from the repo root — confirm zero failures across all packages.
2. Manually verify in the browser per this session's established convention (restart the backend first if it's been running a while — see the "no --watch" gotcha): save a couple of safe test gRPC steps (never real ZaloPay data) with at least one deliberately pointed at an unreachable server address to prove independent failure, filter to them on API Automation, click Run, confirm each shows its own correct Passed/Failed status without one blocking the other, click a result row to see its response/error detail, change a filter and confirm the results list clears, and confirm a row in the list above still loads into Simple Mode correctly. Take a screenshot as evidence. Clean up any test data written to `packages/server/data/steps.json`/`flows.json` afterward.
