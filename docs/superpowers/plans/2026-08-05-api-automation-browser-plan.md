# API Automation Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third left-menu item, "API Automation," that lists every saved gRPC step, lets the user filter it by Service / Method / E2E flow, and loads a chosen step into Simple Mode.

**Architecture:** A new `ApiAutomationPage` component fetches every saved step's full content (`fetchStep`) and every saved flow's step list (`fetchFlow`) on mount, derives the gRPC-only step list with computed flow membership, and renders three `<input list>`+`<datalist>` filters plus a filtered, clickable results list. `Sidebar` gains a third `NavLink`; `App.tsx` gains one new `<Route>` wiring `stepNames`, `flowNames`, and the existing `setForm` setter into the new page. No backend changes.

**Tech Stack:** React 18, TypeScript, react-router-dom v6 (`useNavigate`, `NavLink`, `Route`), Vitest + React Testing Library + `@testing-library/user-event`.

## Global Constraints

- Route path is exactly `/api-automation`; Sidebar label is exactly "API Automation".
- Only steps with `form.protocol === 'grpc'` appear on this page — REST steps (including ones with no `protocol` field at all) are excluded entirely.
- Filters are free-text `<input list="...">` + `<datalist>` comboboxes (not `<select>`), matching the existing Actor/Task/Service/Method pattern in `ScreenplayHeader`/`RequestBuilder`.
- Matching is substring, case-insensitive; an empty filter value imposes no constraint.
- The Method filter's `<datalist>` suggestions narrow to entries whose Service matches the current Service filter value. The E2E flow filter's `<datalist>` suggestions are **every** saved flow name, unfiltered by gRPC content — this is a deliberate, user-confirmed departure from the Service→Method narrowing pattern.
- Clicking a result row calls the page's `onFormChange` prop with that step's full `FormState`, then navigates to `/`.
- No new backend routes. Only `fetchStepNames`, `fetchStep`, `fetchFlowNames`, `fetchFlow` (all already in `packages/web/src/steps.ts` / `packages/web/src/flows.ts`) are used.
- Every `BrowserRouter`/`MemoryRouter` in both app code and tests must include `future={{ v7_startTransition: true, v7_relativeSplatPath: true }}` (established project convention — omitting it produces console deprecation warnings that break this project's zero-console-noise test standard).
- Reuse existing CSS classes (`.label`, `.text-input`, `.row`, `.app-main`, `.heading-xl`) wherever the existing pattern fits; add new classes only for the result-row layout, which has no existing equivalent (`.flow-step-row` is styled for drag-and-drop with `cursor: grab` and doesn't fit a click-to-navigate button).

---

### Task 1: Sidebar nav entry for API Automation

**Files:**
- Modify: `packages/web/src/components/Sidebar.tsx`
- Modify: `packages/web/test/components/Sidebar.test.tsx`

**Interfaces:**
- Consumes: nothing new — `NavLink` from `react-router-dom`, already imported.
- Produces: a `/api-automation` link with text "API Automation" that later tasks' routing depends on.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `packages/web/test/components/Sidebar.test.tsx` with:

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
  it('renders all three nav items with the correct hrefs', () => {
    renderSidebar('/');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).toHaveAttribute('href', '/e2e-test');
    expect(screen.getByRole('link', { name: 'API Automation' })).toHaveAttribute('href', '/api-automation');
  });

  it('marks Simple Mode active on the root path', () => {
    renderSidebar('/');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'API Automation' })).not.toHaveAttribute('aria-current');
  });

  it('marks End-to-end test active on /e2e-test, not the others', () => {
    renderSidebar('/e2e-test');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'API Automation' })).not.toHaveAttribute('aria-current');
  });

  it('marks API Automation active on /api-automation, not the others', () => {
    renderSidebar('/api-automation');
    expect(screen.getByRole('link', { name: 'API Automation' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).not.toHaveAttribute('aria-current');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- Sidebar.test.tsx`
Expected: FAIL — `getByRole('link', { name: 'API Automation' })` finds no element.

- [ ] **Step 3: Add the NavLink**

In `packages/web/src/components/Sidebar.tsx`, add a third `NavLink` after the "End-to-end test" one so the file reads:

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
      <NavLink
        to="/api-automation"
        className={({ isActive }) => (isActive ? 'sidebar-link sidebar-link--active' : 'sidebar-link')}
      >
        API Automation
      </NavLink>
    </nav>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- Sidebar.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/Sidebar.tsx packages/web/test/components/Sidebar.test.tsx
git commit -m "feat(web): add API Automation nav entry to Sidebar"
```

---

### Task 2: `ApiAutomationPage` component

**Files:**
- Create: `packages/web/src/components/ApiAutomationPage.tsx`
- Create: `packages/web/test/components/ApiAutomationPage.test.tsx`
- Modify: `packages/web/src/styles.css`

**Interfaces:**
- Consumes: `fetchStep(name: string): Promise<FormState | undefined>` and `fetchFlow(name: string): Promise<string[] | undefined>` from `../steps` / `../flows` (existing, unchanged). `FormState`/`GrpcFormState` from `../types` (existing, unchanged — `protocol: 'rest' | 'grpc'`, `grpc.service: string`, `grpc.method: string`).
- Produces: `ApiAutomationPage(props: ApiAutomationPageProps)` where
  ```ts
  export interface ApiAutomationPageProps {
    stepNames: string[];
    flowNames: string[];
    onFormChange: Dispatch<SetStateAction<FormState>>;
  }
  ```
  Task 3 imports `{ ApiAutomationPage, type ApiAutomationPageProps }` and passes `stepNames`, `flowNames`, `onFormChange={setForm}` from `App.tsx`'s existing state.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/components/ApiAutomationPage.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ApiAutomationPage } from '../../src/components/ApiAutomationPage';
import type { FormState } from '../../src/types';

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

function stubFetch() {
  return vi.fn((url: string) => {
    if (url.startsWith('/steps/')) {
      const name = decodeURIComponent(url.replace('/steps/', ''));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(STEPS[name]) });
    }
    if (url.startsWith('/flows/')) {
      const name = decodeURIComponent(url.replace('/flows/', ''));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(FLOWS[name] ?? []) });
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/web test -- ApiAutomationPage.test.tsx`
Expected: FAIL — cannot find module `../../src/components/ApiAutomationPage`.

- [ ] **Step 3: Write the component**

Create `packages/web/src/components/ApiAutomationPage.tsx`:

```tsx
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FormState } from '../types';
import { fetchStep } from '../steps';
import { fetchFlow } from '../flows';

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

export function ApiAutomationPage({ stepNames, flowNames, onFormChange }: ApiAutomationPageProps) {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<GrpcStepEntry[]>([]);
  const [serviceFilter, setServiceFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [flowFilter, setFlowFilter] = useState('');

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

  function handleRowClick(entry: GrpcStepEntry) {
    onFormChange(entry.form);
    navigate('/');
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
            onChange={(e) => setServiceFilter(e.target.value)}
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
            onChange={(e) => setMethodFilter(e.target.value)}
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
            onChange={(e) => setFlowFilter(e.target.value)}
          />
          <datalist id="api-automation-flow-options">
            {flowNames.map((flowName) => (
              <option key={flowName} value={flowName} />
            ))}
          </datalist>
        </label>
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
    </main>
  );
}
```

- [ ] **Step 4: Add the result-row CSS**

Append to the end of `packages/web/src/styles.css`:

```css
/* API Automation browser */
.step-browser-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.step-browser-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-lg);
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--color-ink);
  background: var(--color-canvas);
  cursor: pointer;
  text-align: left;
}

.step-browser-meta {
  color: var(--color-mute);
}

.step-browser-flows {
  margin-left: auto;
  color: var(--color-mute);
  font-size: 12px;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/web test -- ApiAutomationPage.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/ApiAutomationPage.tsx packages/web/test/components/ApiAutomationPage.test.tsx packages/web/src/styles.css
git commit -m "feat(web): add ApiAutomationPage with Service/Method/E2E flow filters"
```

---

### Task 3: Wire `ApiAutomationPage` into `App.tsx`

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/test/App.test.tsx`

**Interfaces:**
- Consumes: `ApiAutomationPage` and `ApiAutomationPageProps` from `./components/ApiAutomationPage` (Task 2). `App`'s existing `stepNames`, `flowNames` state and `setForm` setter (all pre-existing, unchanged).
- Produces: nothing new for later tasks — this is the final integration point.

- [ ] **Step 1: Write the failing test**

In `packages/web/test/App.test.tsx`, add this test at the end of the `describe('App', ...)` block, immediately after the `'preserves in-progress Simple Mode form state after navigating away and back'` test (before the closing `});` of the describe block):

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/web test -- App.test.tsx`
Expected: FAIL — no link named "API Automation" (route doesn't exist yet).

- [ ] **Step 3: Add the route**

In `packages/web/src/App.tsx`, add the import and the new `<Route>`:

```tsx
import { EndToEndTestPage } from './components/EndToEndTestPage';
import { ApiAutomationPage } from './components/ApiAutomationPage';
```

and, inside `<Routes>`, immediately after the `/e2e-test` route:

```tsx
          <Route
            path="/api-automation"
            element={
              <ApiAutomationPage
                stepNames={stepNames}
                flowNames={flowNames}
                onFormChange={setForm}
              />
            }
          />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- App.test.tsx`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Run the full web test suite and typecheck**

Run: `pnpm --filter @ai-native-testing/web test`
Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: PASS / no errors

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/App.tsx packages/web/test/App.test.tsx
git commit -m "feat(web): wire API Automation route into App"
```

---

## Final Verification

After Task 3:

1. Run `pnpm test` and `pnpm typecheck` from the repo root — confirm zero failures across all packages.
2. Manually verify in the browser per this session's established convention (see `packages/server` "no --watch" gotcha — restart the backend if it's been running a while): start backend + web dev server, save one or two safe test gRPC steps (e.g. against `jsonplaceholder.typicode.com`-style safe endpoints, never real ZaloPay data), add one to a flow, navigate to API Automation, confirm the step list, filters, and row-click-to-Simple-Mode all work, then take a screenshot as evidence. Clean up any test data written to `packages/server/data/steps.json`/`flows.json` afterward.
