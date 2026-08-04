# Left Menu Navigation (Simple Mode / End-to-end test) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's single scrolling page and hardcoded title with a persistent left sidebar menu ("Simple Mode" / "End-to-end test") that routes between two views, without losing any existing behavior or in-progress form state.

**Architecture:** `react-router-dom` (`BrowserRouter`/`Routes`/`Route`/`NavLink`) wraps the app. `App.tsx` keeps 100% of its existing state, fetches, and handler functions unchanged — only its JSX return value changes, from one flat tree to a router shell rendering a persistent `Sidebar` plus one of two new, purely presentational page components (`SimpleModePage`, `EndToEndTestPage`) that receive everything via props. Because state ownership never moves, in-progress Simple Mode form state survives navigating away and back.

**Tech Stack:** TypeScript, React 18, `react-router-dom` (new dependency, the app's second runtime dependency after `react`/`react-dom`), Vitest, React Testing Library.

Spec: [`docs/superpowers/specs/2026-08-04-left-menu-navigation-design.md`](../specs/2026-08-04-left-menu-navigation-design.md)

## Global Constraints

- Visiting the bare app URL (`/`) renders Simple Mode directly — no redirect, matching today's behavior exactly.
- `SimpleModePage`/`EndToEndTestPage` carry zero logic of their own — pure prop-forwarding wrappers. All computation (`isFormValid`, `isBodyValid`, `isGrpcMessageValid`, `deriveResults`, `variablesRecord`) stays in `App.tsx` exactly where it is today; only the final computed values (`results`, `disabled`) are passed down as props.
- The `/` `NavLink` MUST use the `end` prop — without it, `/` matches as a path-prefix of `/e2e-test` too, and both menu items would show as active simultaneously when on `/e2e-test`. (Verified directly: without `end`, both items get `aria-current="page"` on `/e2e-test`; with `end`, only the correct one does.)
- `BrowserRouter` (and `MemoryRouter` in tests) must pass `future={{ v7_startTransition: true, v7_relativeSplatPath: true }}` — without it, every test run prints two React Router "future flag" deprecation warnings to stderr. Verified these flags silence the warnings with no behavior change for this app's simple two-route, non-splat setup.
- No new colors — sidebar styling reuses existing tokens only: `--color-surface-soft`, `--color-hairline`, `--color-ink`, `--color-body`, `--color-mute`.
- No responsive/mobile collapse behavior, no third menu item, no nested routes — exactly two flat routes (`/`, `/e2e-test`).
- No existing component (`RequestBuilder`, `FlowRunner`, `RunButton`, `SaveStepButton`, `AddToFlowButton`, `ScreenplayHeader`, `LoadStepSelect`, `KeyValueRows`, `ResultsPanel`) changes at all — only `App.tsx`'s top-level JSX is restructured.

---

### Task 1: `react-router-dom` dependency + `Sidebar` component

**Files:**
- Modify: `packages/web/package.json`
- Create: `packages/web/src/components/Sidebar.tsx`
- Create: `packages/web/test/components/Sidebar.test.tsx`
- Modify: `packages/web/src/styles.css`

**Interfaces:**
- Produces: `Sidebar` component (no props). Consumed by `App` (Task 2).

- [ ] **Step 1: Add the `react-router-dom` dependency**

In `packages/web/package.json`, change:

```json
  "dependencies": {
    "@ai-native-testing/engine": "workspace:*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
```

to:

```json
  "dependencies": {
    "@ai-native-testing/engine": "workspace:*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.30.4"
  },
```

Run: `pnpm install`
Expected: installs `react-router-dom` (and its `react-router`/`@remix-run/router` dependencies) into `packages/web`.

- [ ] **Step 2: Write failing tests for `Sidebar`**

Create `packages/web/test/components/Sidebar.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../../src/components/Sidebar';

function renderSidebar(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Sidebar />
    </MemoryRouter>
  );
}

describe('Sidebar', () => {
  it('renders both nav items with the correct hrefs', () => {
    renderSidebar('/');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).toHaveAttribute('href', '/e2e-test');
  });

  it('marks Simple Mode active on the root path', () => {
    renderSidebar('/');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).not.toHaveAttribute('aria-current');
  });

  it('marks End-to-end test active on /e2e-test, not Simple Mode', () => {
    renderSidebar('/e2e-test');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).not.toHaveAttribute('aria-current');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- Sidebar.test`
Expected: FAIL — `../../src/components/Sidebar` does not exist.

- [ ] **Step 4: Implement `Sidebar`**

Create `packages/web/src/components/Sidebar.tsx`:

```tsx
import { NavLink } from 'react-router-dom';

export function Sidebar() {
  return (
    <nav className="sidebar">
      <p className="sidebar-label">API Runner</p>
      <NavLink
        to="/"
        end
        className={({ isActive }) => (isActive ? 'sidebar-link sidebar-link--active' : 'sidebar-link')}
      >
        Simple Mode
      </NavLink>
      <NavLink
        to="/e2e-test"
        className={({ isActive }) => (isActive ? 'sidebar-link sidebar-link--active' : 'sidebar-link')}
      >
        End-to-end test
      </NavLink>
    </nav>
  );
}
```

- [ ] **Step 5: Add sidebar styles**

In `packages/web/src/styles.css`, change:

```css
.app-main {
  max-width: 720px;
  margin: 0 auto;
  padding: var(--space-xxl) var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
}
```

to:

```css
.app-shell {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  width: 180px;
  flex-shrink: 0;
  background: var(--color-surface-soft);
  border-right: 1px solid var(--color-hairline);
  padding: var(--space-xl) 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.sidebar-label {
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-mute);
  padding: 0 var(--space-lg);
  margin: 0 0 var(--space-md);
}

.sidebar-link {
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 500;
  color: var(--color-body);
  text-decoration: none;
  padding: var(--space-sm) var(--space-lg);
  border-left: 3px solid transparent;
}

.sidebar-link--active {
  color: var(--color-ink);
  font-weight: 600;
  border-left-color: var(--color-ink);
}

.app-main {
  flex: 1;
  max-width: 720px;
  margin: 0 auto;
  padding: var(--space-xxl) var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- Sidebar.test`
Expected: PASS (all 3 tests).

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/package.json pnpm-lock.yaml packages/web/src/components/Sidebar.tsx packages/web/test/components/Sidebar.test.tsx packages/web/src/styles.css
git commit -m "feat(web): add react-router-dom and a Sidebar component"
```

---

### Task 2: Extract `SimpleModePage`/`EndToEndTestPage` and wire routing into `App`

**Files:**
- Create: `packages/web/src/components/SimpleModePage.tsx`
- Create: `packages/web/src/components/EndToEndTestPage.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/test/App.test.tsx`

**Interfaces:**
- Consumes: `Sidebar` (Task 1).
- Produces: `SimpleModePage` (props: `error`, `form`, `onFormChange`, `actorOptions`, `taskOptions`, `stepNames`, `onStepNamesChange`, `flowNames`, `onFlowNamesChange`, `results`, `disabled`, `onRunStart`, `onEvent`, `onError`), `EndToEndTestPage` (props: `flowNames`). Both consumed only by `App`.

- [ ] **Step 1: Create `SimpleModePage`**

Create `packages/web/src/components/SimpleModePage.tsx`:

```tsx
import type { Dispatch, SetStateAction } from 'react';
import type { RunEvent } from '@ai-native-testing/engine';
import type { FormState } from '../types';
import type { DerivedResults } from '../results';
import { ScreenplayHeader } from './ScreenplayHeader';
import { KeyValueRows } from './KeyValueRows';
import { RequestBuilder } from './RequestBuilder';
import { RunButton } from './RunButton';
import { ResultsPanel } from './ResultsPanel';
import { SaveStepButton } from './SaveStepButton';
import { LoadStepSelect } from './LoadStepSelect';
import { AddToFlowButton } from './AddToFlowButton';

export interface SimpleModePageProps {
  error: string | null;
  form: FormState;
  onFormChange: Dispatch<SetStateAction<FormState>>;
  actorOptions: string[];
  taskOptions: string[];
  stepNames: string[];
  onStepNamesChange: (names: string[]) => void;
  flowNames: string[];
  onFlowNamesChange: (flowNames: string[]) => void;
  results: DerivedResults | null;
  disabled: boolean;
  onRunStart: () => void;
  onEvent: (event: RunEvent) => void;
  onError: (message: string) => void;
}

export function SimpleModePage({
  error,
  form,
  onFormChange,
  actorOptions,
  taskOptions,
  stepNames,
  onStepNamesChange,
  flowNames,
  onFlowNamesChange,
  results,
  disabled,
  onRunStart,
  onEvent,
  onError,
}: SimpleModePageProps) {
  return (
    <main className="app-main">
      <h1 className="heading-xl">Simple Mode</h1>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <ScreenplayHeader
        actorName={form.actorName}
        onActorNameChange={(actorName) => onFormChange((prev) => ({ ...prev, actorName }))}
        taskName={form.taskName}
        onTaskNameChange={(taskName) => onFormChange((prev) => ({ ...prev, taskName }))}
        actorOptions={actorOptions}
        taskOptions={taskOptions}
      />
      <LoadStepSelect stepNames={stepNames} onLoad={onFormChange} />
      <KeyValueRows
        label="Variables"
        rows={form.variables}
        onChange={(variables) => onFormChange((prev) => ({ ...prev, variables }))}
      />
      <RequestBuilder
        protocol={form.protocol}
        onProtocolChange={(protocol) => onFormChange((prev) => ({ ...prev, protocol }))}
        method={form.method}
        onMethodChange={(method) => onFormChange((prev) => ({ ...prev, method }))}
        url={form.url}
        onUrlChange={(url) => onFormChange((prev) => ({ ...prev, url }))}
        params={form.params}
        onParamsChange={(params) => onFormChange((prev) => ({ ...prev, params }))}
        headers={form.headers}
        onHeadersChange={(headers) => onFormChange((prev) => ({ ...prev, headers }))}
        auth={form.auth}
        onAuthChange={(auth) => onFormChange((prev) => ({ ...prev, auth }))}
        body={form.body}
        onBodyChange={(body) => onFormChange((prev) => ({ ...prev, body }))}
        grpc={form.grpc}
        onGrpcChange={(grpc) => onFormChange((prev) => ({ ...prev, grpc }))}
        extracts={form.extracts}
        onExtractsChange={(extracts) => onFormChange((prev) => ({ ...prev, extracts }))}
        questions={form.questions}
        onQuestionsChange={(questions) => onFormChange((prev) => ({ ...prev, questions }))}
      />
      <RunButton form={form} disabled={disabled} onRunStart={onRunStart} onEvent={onEvent} onError={onError} />
      <SaveStepButton form={form} disabled={disabled} existingNames={stepNames} onSaved={onStepNamesChange} />
      <AddToFlowButton stepNames={stepNames} flowNames={flowNames} onAdded={onFlowNamesChange} />
      <ResultsPanel results={results} />
    </main>
  );
}
```

- [ ] **Step 2: Create `EndToEndTestPage`**

Create `packages/web/src/components/EndToEndTestPage.tsx`:

```tsx
import { FlowRunner } from './FlowRunner';

export interface EndToEndTestPageProps {
  flowNames: string[];
}

export function EndToEndTestPage({ flowNames }: EndToEndTestPageProps) {
  return (
    <main className="app-main">
      <h1 className="heading-xl">End-to-end test</h1>
      <FlowRunner flowNames={flowNames} />
    </main>
  );
}
```

- [ ] **Step 3: Write failing tests for navigation and state preservation**

In `packages/web/test/App.test.tsx`, change:

```tsx
  it('renders the page heading', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { name: 'API Runner — REST (Simple Mode)' })
    ).toBeInTheDocument();
  });
```

to:

```tsx
  it('renders the page heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Simple Mode' })).toBeInTheDocument();
  });
```

Then add this block at the end of the file, right before the final closing `});` of the `describe('App', ...)` block:

```tsx

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
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- App.test`
Expected: FAIL — `App` still renders the old single-page layout with the old heading; there is no `Sidebar`/routing yet, so no "End-to-end test" link exists to click.

- [ ] **Step 5: Wire routing into `App.tsx`**

Replace the entire contents of `packages/web/src/App.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import type { RunEvent, StepResult } from '@ai-native-testing/engine';
import type { FormState } from './types';
import { deriveResults, type DerivedResults } from './results';
import { fetchNames, saveName } from './nameLists';
import { fetchStepNames } from './steps';
import { fetchFlowNames } from './flows';
import { Sidebar } from './components/Sidebar';
import { SimpleModePage } from './components/SimpleModePage';
import { EndToEndTestPage } from './components/EndToEndTestPage';

function initialForm(): FormState {
  return {
    actorName: '',
    taskName: '',
    variables: [],
    protocol: 'rest',
    method: 'GET',
    url: '',
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

function isBodyValid(body: string): boolean {
  if (body.trim() === '') {
    return true;
  }
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}

function isGrpcMessageValid(requestMessage: string): boolean {
  if (requestMessage.trim() === '') {
    return true;
  }
  try {
    JSON.parse(requestMessage);
    return true;
  } catch {
    return false;
  }
}

function isFormValid(form: FormState): boolean {
  if (form.taskName.trim() === '') {
    return false;
  }
  if (form.protocol === 'grpc') {
    if (
      form.grpc.serverAddress.trim() === '' ||
      form.grpc.service.trim() === '' ||
      form.grpc.method.trim() === '' ||
      form.grpc.protoContent.trim() === ''
    ) {
      return false;
    }
    if (!isGrpcMessageValid(form.grpc.requestMessage)) {
      return false;
    }
  } else {
    if (form.url.trim() === '') {
      return false;
    }
    if (!isBodyValid(form.body)) {
      return false;
    }
  }
  for (const row of form.extracts) {
    if (row.source !== 'status' && row.path.trim() === '') return false;
    if (row.rememberAs.trim() === '') return false;
  }
  for (const row of form.questions) {
    if (row.source !== 'status' && row.path.trim() === '') return false;
    if (row.expected.trim() === '') return false;
  }
  return true;
}

export function App() {
  const [form, setForm] = useState<FormState>(initialForm());
  const [stepResults, setStepResults] = useState<(StepResult | undefined)[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actorOptions, setActorOptions] = useState<string[]>([]);
  const [taskOptions, setTaskOptions] = useState<string[]>([]);
  const [stepNames, setStepNames] = useState<string[]>([]);
  const [flowNames, setFlowNames] = useState<string[]>([]);

  useEffect(() => {
    fetchNames('/actors').then(setActorOptions);
    fetchNames('/tasks').then(setTaskOptions);
    fetchStepNames().then(setStepNames);
    fetchFlowNames().then(setFlowNames);
  }, []);

  function handleEvent(event: RunEvent) {
    if (event.type === 'step:completed' || event.type === 'step:failed') {
      setStepResults((prev) => {
        const next = [...prev];
        next[event.index] = event.result;
        return next;
      });
    }
  }

  function handleRunStart() {
    setError(null);
    setStepResults([]);

    const actorName = form.actorName.trim();
    if (actorName !== '' && !actorOptions.includes(actorName)) {
      saveName('/actors', actorName);
      setActorOptions((prev) => [...prev, actorName]);
    }

    const taskName = form.taskName.trim();
    if (taskName !== '' && !taskOptions.includes(taskName)) {
      saveName('/tasks', taskName);
      setTaskOptions((prev) => [...prev, taskName]);
    }
  }

  const variablesRecord = Object.fromEntries(
    form.variables.filter((row) => row.key.trim() !== '').map((row) => [row.key, row.value])
  );

  const results: DerivedResults | null =
    stepResults.length > 0 ? deriveResults(form.extracts, variablesRecord, stepResults) : null;

  const disabled = !isFormValid(form);

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="app-shell">
        <Sidebar />
        <Routes>
          <Route
            path="/"
            element={
              <SimpleModePage
                error={error}
                form={form}
                onFormChange={setForm}
                actorOptions={actorOptions}
                taskOptions={taskOptions}
                stepNames={stepNames}
                onStepNamesChange={setStepNames}
                flowNames={flowNames}
                onFlowNamesChange={setFlowNames}
                results={results}
                disabled={disabled}
                onRunStart={handleRunStart}
                onEvent={handleEvent}
                onError={setError}
              />
            }
          />
          <Route path="/e2e-test" element={<EndToEndTestPage flowNames={flowNames} />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- App.test`
Expected: PASS (all 7 tests — 5 existing plus the 2 new ones).

- [ ] **Step 7: Run the full web test suite**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including `Sidebar.test.tsx` from Task 1) — no other test file references the old heading text or the old single-page layout.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/components/SimpleModePage.tsx packages/web/src/components/EndToEndTestPage.tsx packages/web/src/App.tsx packages/web/test/App.test.tsx
git commit -m "feat(web): route Simple Mode and End-to-end test behind a left sidebar menu"
```

---

### Task 3: Final verification

**Files:** none created or modified — this task only runs checks.

**Interfaces:** none.

- [ ] **Step 1: Run the full workspace test suite and typecheck**

Run: `pnpm test`
Expected: PASS across all 6 packages (`engine`, `runner-api`, `runner-grpc`, `runner-log`, `server`, `web`), no newly failing tests.

Run: `pnpm typecheck`
Expected: no errors in any package.

- [ ] **Step 2: Manual browser verification**

Start the backend (`pnpm --filter @ai-native-testing/server start`) and the GUI dev server (`pnpm --filter @ai-native-testing/web dev`). In the browser, confirm:

- The sidebar shows "API Runner" above two items, "Simple Mode" and "End-to-end test"; "Simple Mode" is active by default at the bare URL.
- Clicking "End-to-end test" shows that page's heading and the Flow picker/Run Flow UI; "Simple Mode" is no longer active in the sidebar.
- Filling in a Task name (and other fields) on Simple Mode, clicking over to "End-to-end test", then clicking back to "Simple Mode" shows the exact same in-progress form values — nothing was lost.
- A full single-request Run (fill Task/URL, click Run) still works exactly as before, producing a real response in the Results panel.
- A full End-to-end test run (pick a previously-saved flow, click Run Flow) still works exactly as before, producing the per-task pass/fail checklist.
- The browser's URL bar shows `/` on Simple Mode and `/e2e-test` on the other page, and the browser back/forward buttons move between them correctly.

Take a screenshot as evidence, same as prior manual verifications in this project.

- [ ] **Step 3: Commit (if the manual check surfaced any fix)**

If Step 2 finds nothing to fix, there is nothing to commit for this task. If it does surface an issue, fix it, re-run Step 1, and commit:

```bash
git add -A
git commit -m "fix: correct issue found during manual left-menu navigation verification"
```
