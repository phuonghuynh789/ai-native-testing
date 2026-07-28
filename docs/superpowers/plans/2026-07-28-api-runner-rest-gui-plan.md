# API Runner: REST GUI (Simple Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React + TypeScript single-page GUI (`packages/web`) that lets a user construct one REST API test (Actor, Task, one HTTP request, any number of extract/assertion steps) without hand-writing the `TestDefinition` JSON, run it against the existing backend via SSE, and see live, step-by-step results.

**Architecture:** One small additive `RestRunner` action (`raw`, returning the whole captured HTTP response) closes a real gap found while tracing the design through the actual backend code. Everything else is new frontend code: pure functions (`buildTestDefinition`, `deriveResults`) that translate between form state and the engine's DSL/step results, a set of small React components composing into one `App`, and a `RunButton` that talks to the already-existing `POST /runs` and `GET /runs/:jobId/events` (SSE) endpoints — no other backend changes.

**Tech Stack:** React 18 + TypeScript + Vite (new `packages/web` workspace member), Vitest + React Testing Library + `@testing-library/user-event` for tests, browser `fetch`/`EventSource` for talking to the backend — no state-management library, no router.

Spec: [`docs/superpowers/specs/2026-07-28-api-runner-rest-gui-design.md`](../specs/2026-07-28-api-runner-rest-gui-design.md)

## Global Constraints

- Node.js >= 20.
- pnpm workspace, `packages/*` (already configured — no changes to `pnpm-workspace.yaml`).
- TypeScript strict mode everywhere.
- `packages/engine`, `runner-api`, `runner-log`, `server`: ESM, `module`/`moduleResolution: "NodeNext"`, explicit `.js` extensions on relative imports — existing convention, unchanged.
- `packages/web`: ESM, but uses `"moduleResolution": "Bundler"` (not `NodeNext`) and **no** explicit extensions on relative imports — a deliberate, justified exception, since this package is bundled by Vite rather than run directly by Node. Do not "fix" its imports to add `.js`.
- Vitest (`vitest run`) as the test runner everywhere; `packages/web` additionally uses `environment: "jsdom"` plus React Testing Library and `@testing-library/user-event` for component tests.
- Task 1 adds zero new dependencies (one new `switch` case in existing code).
- `packages/web`'s only *runtime* dependencies are `react`, `react-dom`, and `@ai-native-testing/engine` (types only, via `workspace:*`). Everything else (`vite`, `@vitejs/plugin-react`, testing libraries, `typescript`) is a devDependency.
- REST GUI Simple Mode only: builds and runs exactly **one** REST API test (one Actor, one Task, one `request` interaction, any number of `extract`/`question` steps against that single response). No multi-task E2E flow builder, no gRPC/GraphQL GUI, no Advanced Mode, no persistence (no Save/Load, no Project, no named Environment).
- The Actor's `abilities` is always hardcoded to `["rest"]` — no Ability picker in the UI.
- Live run results only via SSE (`GET /runs/:jobId/events`, using the browser's `EventSource`) — no polling loop anywhere.
- `buildTestDefinition` always inserts one hidden `extract` step (`action: "raw"`, `remember: "__response"`) immediately after the `request` interaction (index 1) — it never appears in the Extract editor and is excluded from the Saved Values panel.
- Vite's dev server proxies `/runs*` to `http://localhost:3000` — no CORS changes to the backend. Production build/serving strategy is out of scope.
- Explicitly out of scope — do not implement: gRPC/GraphQL GUI, Advanced Mode GUI, a multi-task E2E flow builder, any persistence, automated browser-driven end-to-end tests (e.g. Playwright), a production deployment/serving strategy for the frontend.

---

### Task 1: `RestRunner` — add the `raw` ask action

**Files:**
- Modify: `packages/runner-api/src/rest-runner.ts`
- Test: `packages/runner-api/test/rest-runner.test.ts`

**Interfaces:**
- Consumes: nothing new — reuses the existing internal `RestResponse` shape (`{ status, headers, body }`) already stored under `__rest.lastResponse`.
- Produces: `ask('raw', {}, ctx)` returns that whole `RestResponse` object. Consumed later by `packages/web`'s hidden `extract` step (Task 3 onward).

- [ ] **Step 1: Write a failing test for the `raw` action**

In `packages/runner-api/test/rest-runner.test.ts`, add the following test inside the `describe('RestRunner', () => { ... })` block, right before its closing `});`:

```ts
  it('returns the whole response via the raw action', async () => {
    server = await startTestServer((req, res) => {
      res.writeHead(201, { 'Content-Type': 'application/json', 'X-Request-Id': 'req-1' });
      res.end(JSON.stringify({ data: { paymentId: 'pay_1' } }));
    });

    const runner = new RestRunner();
    const ctx = new RunContext();
    await runner.interact('request', { method: 'GET', url: server.url }, ctx);

    const raw = (await runner.ask('raw', {}, ctx)) as {
      status: number;
      headers: Record<string, string>;
      body: unknown;
    };
    expect(raw.status).toBe(201);
    expect(raw.headers['content-type']).toBe('application/json');
    expect(raw.headers['x-request-id']).toBe('req-1');
    expect(raw.body).toEqual({ data: { paymentId: 'pay_1' } });
  });
```

Note this checks individual fields rather than exact equality on the whole `headers` object — Node's HTTP server adds its own framing headers (`date`, `connection`, etc.) regardless of what the test handler sets, so an exact-equality check on the full header map would be flaky.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ai-native-testing/runner-api test`
Expected: FAIL — `RestRunner does not support question "raw"`.

- [ ] **Step 3: Add the `raw` case**

In `packages/runner-api/src/rest-runner.ts`, change:

```ts
    switch (action) {
      case 'status':
        return response.status;
      case 'header':
        return response.headers[String(args.name).toLowerCase()];
      case 'jsonPath':
        return extractJsonPath(response.body, String(args.path));
      default:
        throw new Error(`RestRunner does not support question "${action}"`);
    }
```

to:

```ts
    switch (action) {
      case 'status':
        return response.status;
      case 'header':
        return response.headers[String(args.name).toLowerCase()];
      case 'jsonPath':
        return extractJsonPath(response.body, String(args.path));
      case 'raw':
        return response;
      default:
        throw new Error(`RestRunner does not support question "${action}"`);
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @ai-native-testing/runner-api test`
Expected: PASS (all tests, including the new one).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/runner-api typecheck`
Expected: no errors.

```bash
git add packages/runner-api/src/rest-runner.ts packages/runner-api/test/rest-runner.test.ts
git commit -m "feat(runner-api): add raw ask action returning the whole response"
```

---

### Task 2: `packages/web` scaffold

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/index.html`
- Create: `packages/web/test/setup.ts`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx` (placeholder — replaced wholesale in Task 10)
- Test: `packages/web/test/App.test.tsx` (placeholder — replaced wholesale in Task 10)

**Interfaces:**
- Produces: a working Vite + React + TypeScript + Vitest + React Testing Library pipeline, proven end-to-end by one smoke test. `App` is a placeholder component here; every later task adds real pieces without needing to touch this scaffold again, except Task 10, which replaces `App.tsx`/`App.test.tsx` with the real composition.

- [ ] **Step 1: Create the package manifest**

Create `packages/web/package.json`:

```json
{
  "name": "@ai-native-testing/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ai-native-testing/engine": "workspace:*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "jsdom": "^25.0.1",
    "typescript": "^5.6.3",
    "vite": "^5.4.11",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2: Create the TypeScript config**

Create `packages/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

- [ ] **Step 3: Create the Vite config**

Create `packages/web/vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/runs': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
  },
});
```

- [ ] **Step 4: Create the HTML entry point**

Create `packages/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>API Runner — REST (Simple Mode)</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create the Vitest setup file**

Create `packages/web/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 6: Install workspace dependencies**

Run: `pnpm install`
Expected: `packages/web` is linked into the workspace, no errors. There is nothing to test yet — that's expected until the next steps.

- [ ] **Step 7: Write a failing smoke test**

Create `packages/web/test/App.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../src/App';

describe('App', () => {
  it('renders the page heading', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { name: 'API Runner — REST (Simple Mode)' })
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `../src/App` does not exist.

- [ ] **Step 9: Implement the placeholder `App` and entry point**

Create `packages/web/src/App.tsx`:

```tsx
export function App() {
  return <h1>API Runner — REST (Simple Mode)</h1>;
}
```

Create `packages/web/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('root element not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS.

- [ ] **Step 11: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web pnpm-lock.yaml
git commit -m "feat(web): scaffold Vite + React + TypeScript + Vitest package"
```

---

### Task 3: `dsl.ts` — form state types and `buildTestDefinition`

**Files:**
- Create: `packages/web/src/types.ts`
- Create: `packages/web/src/dsl.ts`
- Test: `packages/web/test/dsl.test.ts`

**Interfaces:**
- Consumes: `Step`, `TestDefinition` types from `@ai-native-testing/engine`.
- Produces: `KeyValueRow`, `SourceKind`, `ExtractRow`, `QuestionRow`, `AuthConfig`, `FormState` (all in `types.ts`); `buildTestDefinition(form: FormState): TestDefinition` and `HIDDEN_RESPONSE_VARIABLE: string` (in `dsl.ts`). Every later component and `App` itself is built against these exact types.

- [ ] **Step 1: Create the form-state types**

Create `packages/web/src/types.ts`:

```ts
export interface KeyValueRow {
  id: string;
  key: string;
  value: string;
}

export type SourceKind = 'status' | 'header' | 'jsonPath';

export interface ExtractRow {
  id: string;
  source: SourceKind;
  path: string;
  rememberAs: string;
}

export interface QuestionRow {
  id: string;
  source: SourceKind;
  path: string;
  expected: string;
}

export type AuthConfig =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'apiKey'; header: string; value: string }
  | { type: 'basic'; username: string; password: string };

export interface FormState {
  actorName: string;
  taskName: string;
  variables: KeyValueRow[];
  method: string;
  url: string;
  params: KeyValueRow[];
  headers: KeyValueRow[];
  auth: AuthConfig;
  body: string;
  extracts: ExtractRow[];
  questions: QuestionRow[];
}
```

- [ ] **Step 2: Write failing tests for `buildTestDefinition`**

Create `packages/web/test/dsl.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTestDefinition, HIDDEN_RESPONSE_VARIABLE } from '../src/dsl';
import type { FormState } from '../src/types';

function emptyForm(overrides: Partial<FormState> = {}): FormState {
  return {
    actorName: 'Authenticated Customer',
    taskName: 'Create Payment',
    variables: [],
    method: 'GET',
    url: 'https://api.example.com',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    extracts: [],
    questions: [],
    ...overrides,
  };
}

describe('buildTestDefinition', () => {
  it('builds an actor with the hardcoded rest ability and the task name', () => {
    const definition = buildTestDefinition(emptyForm());
    expect(definition.actor).toEqual({ name: 'Authenticated Customer', abilities: ['rest'] });
    expect(definition.tasks[0].name).toBe('Create Payment');
  });

  it('always inserts the request step followed by a hidden raw extract step', () => {
    const definition = buildTestDefinition(emptyForm());
    const steps = definition.tasks[0].steps;
    expect(steps[0]).toEqual({
      type: 'interaction',
      runner: 'rest',
      action: 'request',
      with: { method: 'GET', url: 'https://api.example.com' },
    });
    expect(steps[1]).toEqual({
      type: 'extract',
      runner: 'rest',
      action: 'raw',
      remember: HIDDEN_RESPONSE_VARIABLE,
    });
  });

  it('omits variables from the definition when no rows have a key', () => {
    const definition = buildTestDefinition(emptyForm());
    expect(definition.variables).toBeUndefined();
  });

  it('builds variables, params, headers, and auth from key/value rows', () => {
    const definition = buildTestDefinition(
      emptyForm({
        variables: [{ id: '1', key: 'baseUrl', value: 'https://api.example.com' }],
        params: [{ id: '2', key: 'page', value: '2' }],
        headers: [{ id: '3', key: 'X-Trace', value: 'abc' }],
        auth: { type: 'bearer', token: '${accessToken}' },
      })
    );
    expect(definition.variables).toEqual({ baseUrl: 'https://api.example.com' });
    expect(definition.tasks[0].steps[0]).toEqual({
      type: 'interaction',
      runner: 'rest',
      action: 'request',
      with: {
        method: 'GET',
        url: 'https://api.example.com',
        query: { page: '2' },
        headers: { 'X-Trace': 'abc' },
        auth: { type: 'bearer', token: '${accessToken}' },
      },
    });
  });

  it('ignores key/value rows with an empty key', () => {
    const definition = buildTestDefinition(
      emptyForm({ params: [{ id: '1', key: '', value: 'ignored' }] })
    );
    const requestStep = definition.tasks[0].steps[0] as { with: Record<string, unknown> };
    expect(requestStep.with.query).toBeUndefined();
  });

  it('parses the body as JSON', () => {
    const definition = buildTestDefinition(
      emptyForm({ body: '{"orderId":"order-1","amount":10}' })
    );
    const requestStep = definition.tasks[0].steps[0] as { with: Record<string, unknown> };
    expect(requestStep.with.body).toEqual({ orderId: 'order-1', amount: 10 });
  });

  it('builds an extract row into an extract step after the hidden response step', () => {
    const definition = buildTestDefinition(
      emptyForm({
        extracts: [{ id: '1', source: 'jsonPath', path: '$.data.paymentId', rememberAs: 'paymentId' }],
      })
    );
    expect(definition.tasks[0].steps[2]).toEqual({
      type: 'extract',
      runner: 'rest',
      action: 'jsonPath',
      with: { path: '$.data.paymentId' },
      remember: 'paymentId',
    });
  });

  it('builds a question row into a question step with a parsed expected value', () => {
    const definition = buildTestDefinition(
      emptyForm({ questions: [{ id: '1', source: 'status', path: '', expected: '201' }] })
    );
    expect(definition.tasks[0].steps[2]).toEqual({
      type: 'question',
      runner: 'rest',
      action: 'status',
      expect: { equals: 201 },
    });
  });

  it('treats a non-numeric expected value as a plain string', () => {
    const definition = buildTestDefinition(
      emptyForm({
        questions: [{ id: '1', source: 'jsonPath', path: '$.data.status', expected: 'SUCCESS' }],
      })
    );
    const step = definition.tasks[0].steps[2] as { expect: { equals: unknown } };
    expect(step.expect.equals).toBe('SUCCESS');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `../src/dsl` does not exist.

- [ ] **Step 4: Implement `buildTestDefinition`**

Create `packages/web/src/dsl.ts`:

```ts
import type { Step, TestDefinition } from '@ai-native-testing/engine';
import type { AuthConfig, FormState, KeyValueRow, SourceKind } from './types';

export const HIDDEN_RESPONSE_VARIABLE = '__response';

function rowsToRecord(rows: KeyValueRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim() !== '') {
      result[row.key] = row.value;
    }
  }
  return result;
}

function authToDsl(auth: AuthConfig): Record<string, unknown> | undefined {
  switch (auth.type) {
    case 'none':
      return undefined;
    case 'bearer':
      return { type: 'bearer', token: auth.token };
    case 'apiKey':
      return { type: 'apiKey', header: auth.header, value: auth.value };
    case 'basic':
      return { type: 'basic', username: auth.username, password: auth.password };
  }
}

function sourceToStepFields(
  source: SourceKind,
  path: string
): { action: string; with?: Record<string, unknown> } {
  switch (source) {
    case 'status':
      return { action: 'status' };
    case 'header':
      return { action: 'header', with: { name: path } };
    case 'jsonPath':
      return { action: 'jsonPath', with: { path } };
  }
}

function parseExpected(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function buildTestDefinition(form: FormState): TestDefinition {
  const requestWith: Record<string, unknown> = {
    method: form.method,
    url: form.url,
  };
  const params = rowsToRecord(form.params);
  if (Object.keys(params).length > 0) {
    requestWith.query = params;
  }
  const headers = rowsToRecord(form.headers);
  if (Object.keys(headers).length > 0) {
    requestWith.headers = headers;
  }
  const auth = authToDsl(form.auth);
  if (auth) {
    requestWith.auth = auth;
  }
  if (form.body.trim() !== '') {
    requestWith.body = JSON.parse(form.body);
  }

  const steps: Step[] = [
    { type: 'interaction', runner: 'rest', action: 'request', with: requestWith },
    { type: 'extract', runner: 'rest', action: 'raw', remember: HIDDEN_RESPONSE_VARIABLE },
    ...form.extracts.map((row): Step => {
      const { action, with: withFields } = sourceToStepFields(row.source, row.path);
      return { type: 'extract', runner: 'rest', action, with: withFields, remember: row.rememberAs };
    }),
    ...form.questions.map((row): Step => {
      const { action, with: withFields } = sourceToStepFields(row.source, row.path);
      return {
        type: 'question',
        runner: 'rest',
        action,
        with: withFields,
        expect: { equals: parseExpected(row.expected) },
      };
    }),
  ];

  const variables = rowsToRecord(form.variables);

  return {
    actor: { name: form.actorName, abilities: ['rest'] },
    variables: Object.keys(variables).length > 0 ? variables : undefined,
    tasks: [{ name: form.taskName, steps }],
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including the 8 new ones).

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/types.ts packages/web/src/dsl.ts packages/web/test/dsl.test.ts
git commit -m "feat(web): add form-state types and buildTestDefinition"
```

---

### Task 4: `results.ts` — `deriveResults`

**Files:**
- Create: `packages/web/src/results.ts`
- Test: `packages/web/test/results.test.ts`

**Interfaces:**
- Consumes: `StepResult` from `@ai-native-testing/engine`; `ExtractRow` from `./types`.
- Produces: `RawResponse` (`{ status: number; headers: Record<string, string>; body: unknown }`), `DerivedResults` (`{ response: RawResponse | null; savedValues: Record<string, unknown>; context: Record<string, unknown>; logs: string[] }`), and `deriveResults(extracts: ExtractRow[], variables: Record<string, string>, stepResults: (StepResult | undefined)[]): DerivedResults`. Consumed by `ResultsPanel` (Task 8) and `App` (Task 10).

- [ ] **Step 1: Write failing tests for `deriveResults`**

Create `packages/web/test/results.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveResults } from '../src/results';
import type { ExtractRow } from '../src/types';
import type { StepResult } from '@ai-native-testing/engine';

function stepResult(overrides: Partial<StepResult>): StepResult {
  return {
    type: 'interaction',
    runner: 'rest',
    action: 'request',
    status: 'passed',
    ...overrides,
  };
}

describe('deriveResults', () => {
  it('reads the response from the hidden raw step at index 1', () => {
    const stepResults = [
      stepResult({ action: 'request' }),
      stepResult({
        type: 'extract',
        action: 'raw',
        actual: { status: 201, headers: { 'content-type': 'application/json' }, body: { ok: true } },
      }),
    ];
    const result = deriveResults([], {}, stepResults);
    expect(result.response).toEqual({
      status: 201,
      headers: { 'content-type': 'application/json' },
      body: { ok: true },
    });
  });

  it('returns a null response when the hidden raw step has not completed', () => {
    const result = deriveResults([], {}, [stepResult({ action: 'request' })]);
    expect(result.response).toBeNull();
  });

  it('maps extract rows to saved values by index, skipping the hidden step', () => {
    const extracts: ExtractRow[] = [
      { id: '1', source: 'jsonPath', path: '$.data.paymentId', rememberAs: 'paymentId' },
    ];
    const stepResults = [
      stepResult({ action: 'request' }),
      stepResult({ type: 'extract', action: 'raw', actual: { status: 201, headers: {}, body: {} } }),
      stepResult({ type: 'extract', action: 'jsonPath', actual: 'pay_123' }),
    ];
    const result = deriveResults(extracts, {}, stepResults);
    expect(result.savedValues).toEqual({ paymentId: 'pay_123' });
  });

  it('merges saved values over seeded variables in context', () => {
    const extracts: ExtractRow[] = [{ id: '1', source: 'status', path: '', rememberAs: 'baseUrl' }];
    const stepResults = [
      stepResult({ action: 'request' }),
      stepResult({ type: 'extract', action: 'raw', actual: { status: 200, headers: {}, body: {} } }),
      stepResult({ type: 'extract', action: 'status', actual: 200 }),
    ];
    const result = deriveResults(extracts, { baseUrl: 'https://seed.example.com' }, stepResults);
    expect(result.context).toEqual({ baseUrl: 200 });
  });

  it('excludes the hidden raw step from logs', () => {
    const stepResults = [
      stepResult({ action: 'request' }),
      stepResult({ type: 'extract', action: 'raw', actual: {} }),
      stepResult({ type: 'question', action: 'status', status: 'passed' }),
    ];
    const result = deriveResults([], {}, stepResults);
    expect(result.logs).toEqual(['interaction request → passed', 'question status → passed']);
  });

  it('includes the expected/actual values for a failed question in its log line', () => {
    const stepResults = [
      stepResult({ type: 'question', action: 'status', status: 'failed', expected: 200, actual: 404 }),
    ];
    const result = deriveResults([], {}, stepResults);
    expect(result.logs).toEqual(['question status → failed (expected 200, got 404)']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `../src/results` does not exist.

- [ ] **Step 3: Implement `deriveResults`**

Create `packages/web/src/results.ts`:

```ts
import type { StepResult } from '@ai-native-testing/engine';
import type { ExtractRow } from './types';

export interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface DerivedResults {
  response: RawResponse | null;
  savedValues: Record<string, unknown>;
  context: Record<string, unknown>;
  logs: string[];
}

const HIDDEN_RESPONSE_STEP_INDEX = 1;
const FIRST_EXTRACT_STEP_INDEX = 2;

export function deriveResults(
  extracts: ExtractRow[],
  variables: Record<string, string>,
  stepResults: (StepResult | undefined)[]
): DerivedResults {
  const responseResult = stepResults[HIDDEN_RESPONSE_STEP_INDEX];
  const response = responseResult?.status === 'passed' ? (responseResult.actual as RawResponse) : null;

  const savedValues: Record<string, unknown> = {};
  extracts.forEach((row, index) => {
    const result = stepResults[FIRST_EXTRACT_STEP_INDEX + index];
    if (result?.status === 'passed') {
      savedValues[row.rememberAs] = result.actual;
    }
  });

  const context: Record<string, unknown> = { ...variables, ...savedValues };

  const logs = stepResults
    .filter((_, index) => index !== HIDDEN_RESPONSE_STEP_INDEX)
    .filter((result): result is StepResult => result !== undefined)
    .map((result) => {
      const base = `${result.type} ${result.action} → ${result.status}`;
      if (result.status === 'failed') {
        return result.error
          ? `${base} (${result.error})`
          : `${base} (expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(result.actual)})`;
      }
      return base;
    });

  return { response, savedValues, context, logs };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including the 6 new ones).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/results.ts packages/web/test/results.test.ts
git commit -m "feat(web): add deriveResults for the results panel"
```

---

### Task 5: `KeyValueRows` shared component

**Files:**
- Create: `packages/web/src/components/KeyValueRows.tsx`
- Test: `packages/web/test/components/KeyValueRows.test.tsx`

**Interfaces:**
- Consumes: `KeyValueRow` from `../types`.
- Produces: `KeyValueRows({ label: string; rows: KeyValueRow[]; onChange: (rows: KeyValueRow[]) => void })`. Reused by the Variables editor (Task 10) and by `RequestBuilder`'s Params/Headers tabs (Task 7).

- [ ] **Step 1: Write failing tests**

Create `packages/web/test/components/KeyValueRows.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeyValueRows } from '../../src/components/KeyValueRows';

describe('KeyValueRows', () => {
  it('renders one row per item with its key and value', () => {
    render(
      <KeyValueRows
        label="Variables"
        rows={[{ id: '1', key: 'baseUrl', value: 'https://api.example.com' }]}
        onChange={() => {}}
      />
    );
    expect(screen.getByDisplayValue('baseUrl')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://api.example.com')).toBeInTheDocument();
  });

  it('calls onChange with a new empty row when Add is clicked', async () => {
    const onChange = vi.fn();
    render(<KeyValueRows label="Variables" rows={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add Variables row' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const newRows = onChange.mock.calls[0][0];
    expect(newRows).toHaveLength(1);
    expect(newRows[0]).toMatchObject({ key: '', value: '' });
  });

  it('calls onChange with the row removed when Remove is clicked', async () => {
    const onChange = vi.fn();
    render(
      <KeyValueRows
        label="Variables"
        rows={[{ id: '1', key: 'baseUrl', value: 'x' }]}
        onChange={onChange}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove Variables row' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('calls onChange with an updated key when the key input changes', () => {
    const onChange = vi.fn();
    render(
      <KeyValueRows label="Variables" rows={[{ id: '1', key: '', value: '' }]} onChange={onChange} />
    );
    fireEvent.change(screen.getByLabelText('Variables key'), { target: { value: 'baseUrl' } });
    expect(onChange).toHaveBeenCalledWith([{ id: '1', key: 'baseUrl', value: '' }]);
  });
});
```

Note the last test uses `fireEvent.change` (a single, direct value assignment) rather than `userEvent.type`. This component's `onChange` prop is a bare mock here, not wired back into `rows` — with `userEvent.type`'s per-keystroke events, a controlled input whose `value` prop never updates gets reset every keystroke, so only the last character would ever reach the mock. `fireEvent.change` sets the whole value in one shot, which is what this isolated-component test actually needs. (In the real app — Task 10 — `App` *does* feed the updated rows back as props, so real typing there accumulates correctly.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `../../src/components/KeyValueRows` does not exist.

- [ ] **Step 3: Implement `KeyValueRows`**

Create `packages/web/src/components/KeyValueRows.tsx`:

```tsx
import type { KeyValueRow } from '../types';

interface KeyValueRowsProps {
  label: string;
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
}

export function KeyValueRows({ label, rows, onChange }: KeyValueRowsProps) {
  function updateRow(id: string, field: 'key' | 'value', value: string) {
    onChange(rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  }

  function removeRow(id: string) {
    onChange(rows.filter((row) => row.id !== id));
  }

  function addRow() {
    onChange([...rows, { id: crypto.randomUUID(), key: '', value: '' }]);
  }

  return (
    <fieldset>
      <legend>{label}</legend>
      {rows.map((row) => (
        <div key={row.id}>
          <input
            aria-label={`${label} key`}
            value={row.key}
            onChange={(e) => updateRow(row.id, 'key', e.target.value)}
          />
          <input
            aria-label={`${label} value`}
            value={row.value}
            onChange={(e) => updateRow(row.id, 'value', e.target.value)}
          />
          <button type="button" aria-label={`Remove ${label} row`} onClick={() => removeRow(row.id)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={addRow}>
        Add {label} row
      </button>
    </fieldset>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/components/KeyValueRows.tsx packages/web/test/components/KeyValueRows.test.tsx
git commit -m "feat(web): add shared KeyValueRows component"
```

---

### Task 6: `SourceKindSelector`, `ExtractEditor`, `QuestionsEditor`

**Files:**
- Create: `packages/web/src/components/SourceKindSelector.tsx`
- Create: `packages/web/src/components/ExtractEditor.tsx`
- Create: `packages/web/src/components/QuestionsEditor.tsx`
- Test: `packages/web/test/components/ExtractEditor.test.tsx`
- Test: `packages/web/test/components/QuestionsEditor.test.tsx`

**Interfaces:**
- Consumes: `SourceKind`, `ExtractRow`, `QuestionRow` from `../types`.
- Produces: `ExtractEditor({ rows: ExtractRow[]; onChange: (rows: ExtractRow[]) => void })` and `QuestionsEditor({ rows: QuestionRow[]; onChange: (rows: QuestionRow[]) => void })`. Consumed by `RequestBuilder` (Task 7), which renders them as two of its own tabs — per the approved layout, Extract/Questions are tabs alongside Params/Headers/Auth/Body under one "Request" tab bar, not separate top-level sections.

- [ ] **Step 1: Write failing tests for both editors**

Create `packages/web/test/components/ExtractEditor.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExtractEditor } from '../../src/components/ExtractEditor';

describe('ExtractEditor', () => {
  it('adds a new row defaulting to jsonPath source', async () => {
    const onChange = vi.fn();
    render(<ExtractEditor rows={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add extract row' }));
    const newRows = onChange.mock.calls[0][0];
    expect(newRows[0]).toMatchObject({ source: 'jsonPath', path: '', rememberAs: '' });
  });

  it('hides the path input when source is status', () => {
    render(
      <ExtractEditor rows={[{ id: '1', source: 'status', path: '', rememberAs: 'code' }]} onChange={() => {}} />
    );
    expect(screen.queryByLabelText('Extract path')).not.toBeInTheDocument();
  });

  it('shows the path input when source is jsonPath', () => {
    render(
      <ExtractEditor
        rows={[{ id: '1', source: 'jsonPath', path: '$.data.id', rememberAs: 'id' }]}
        onChange={() => {}}
      />
    );
    expect(screen.getByLabelText('Extract path')).toHaveValue('$.data.id');
  });

  it('calls onChange with the row removed', async () => {
    const onChange = vi.fn();
    render(
      <ExtractEditor
        rows={[{ id: '1', source: 'status', path: '', rememberAs: 'code' }]}
        onChange={onChange}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove extract row' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
```

Create `packages/web/test/components/QuestionsEditor.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuestionsEditor } from '../../src/components/QuestionsEditor';

describe('QuestionsEditor', () => {
  it('adds a new row defaulting to status source', async () => {
    const onChange = vi.fn();
    render(<QuestionsEditor rows={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add question row' }));
    const newRows = onChange.mock.calls[0][0];
    expect(newRows[0]).toMatchObject({ source: 'status', path: '', expected: '' });
  });

  it('shows the expected-value input for every source kind', () => {
    render(
      <QuestionsEditor rows={[{ id: '1', source: 'status', path: '', expected: '200' }]} onChange={() => {}} />
    );
    expect(screen.getByLabelText('Expected value')).toHaveValue('200');
  });

  it('calls onChange with an updated expected value', async () => {
    const onChange = vi.fn();
    render(
      <QuestionsEditor rows={[{ id: '1', source: 'status', path: '', expected: '' }]} onChange={onChange} />
    );
    await userEvent.type(screen.getByLabelText('Expected value'), '2');
    expect(onChange).toHaveBeenCalledWith([{ id: '1', source: 'status', path: '', expected: '2' }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — neither component exists yet.

- [ ] **Step 3: Implement the shared `SourceKindSelector`**

Create `packages/web/src/components/SourceKindSelector.tsx`:

```tsx
import type { SourceKind } from '../types';

const SOURCE_KINDS: SourceKind[] = ['status', 'header', 'jsonPath'];

interface SourceKindSelectorProps {
  value: SourceKind;
  onChange: (value: SourceKind) => void;
  ariaLabel: string;
}

export function SourceKindSelector({ value, onChange, ariaLabel }: SourceKindSelectorProps) {
  return (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value as SourceKind)}>
      {SOURCE_KINDS.map((kind) => (
        <option key={kind} value={kind}>
          {kind}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 4: Implement `ExtractEditor`**

Create `packages/web/src/components/ExtractEditor.tsx`:

```tsx
import type { ExtractRow } from '../types';
import { SourceKindSelector } from './SourceKindSelector';

interface ExtractEditorProps {
  rows: ExtractRow[];
  onChange: (rows: ExtractRow[]) => void;
}

export function ExtractEditor({ rows, onChange }: ExtractEditorProps) {
  function updateRow(id: string, patch: Partial<ExtractRow>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function removeRow(id: string) {
    onChange(rows.filter((row) => row.id !== id));
  }

  function addRow() {
    onChange([...rows, { id: crypto.randomUUID(), source: 'jsonPath', path: '', rememberAs: '' }]);
  }

  return (
    <fieldset>
      <legend>Extract</legend>
      {rows.map((row) => (
        <div key={row.id}>
          <SourceKindSelector
            ariaLabel="Extract source"
            value={row.source}
            onChange={(source) => updateRow(row.id, { source })}
          />
          {row.source !== 'status' && (
            <input
              aria-label="Extract path"
              value={row.path}
              onChange={(e) => updateRow(row.id, { path: e.target.value })}
            />
          )}
          <input
            aria-label="Remember as"
            value={row.rememberAs}
            onChange={(e) => updateRow(row.id, { rememberAs: e.target.value })}
          />
          <button type="button" aria-label="Remove extract row" onClick={() => removeRow(row.id)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={addRow}>
        Add extract row
      </button>
    </fieldset>
  );
}
```

- [ ] **Step 5: Implement `QuestionsEditor`**

Create `packages/web/src/components/QuestionsEditor.tsx`:

```tsx
import type { QuestionRow } from '../types';
import { SourceKindSelector } from './SourceKindSelector';

interface QuestionsEditorProps {
  rows: QuestionRow[];
  onChange: (rows: QuestionRow[]) => void;
}

export function QuestionsEditor({ rows, onChange }: QuestionsEditorProps) {
  function updateRow(id: string, patch: Partial<QuestionRow>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function removeRow(id: string) {
    onChange(rows.filter((row) => row.id !== id));
  }

  function addRow() {
    onChange([...rows, { id: crypto.randomUUID(), source: 'status', path: '', expected: '' }]);
  }

  return (
    <fieldset>
      <legend>Questions</legend>
      {rows.map((row) => (
        <div key={row.id}>
          <SourceKindSelector
            ariaLabel="Question source"
            value={row.source}
            onChange={(source) => updateRow(row.id, { source })}
          />
          {row.source !== 'status' && (
            <input
              aria-label="Question path"
              value={row.path}
              onChange={(e) => updateRow(row.id, { path: e.target.value })}
            />
          )}
          <input
            aria-label="Expected value"
            value={row.expected}
            onChange={(e) => updateRow(row.id, { expected: e.target.value })}
          />
          <button type="button" aria-label="Remove question row" onClick={() => removeRow(row.id)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={addRow}>
        Add question row
      </button>
    </fieldset>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/components/SourceKindSelector.tsx packages/web/src/components/ExtractEditor.tsx packages/web/src/components/QuestionsEditor.tsx packages/web/test/components/ExtractEditor.test.tsx packages/web/test/components/QuestionsEditor.test.tsx
git commit -m "feat(web): add ExtractEditor and QuestionsEditor components"
```

---

### Task 7: `RequestBuilder` component (tabbed)

**Files:**
- Create: `packages/web/src/components/RequestBuilder.tsx`
- Test: `packages/web/test/components/RequestBuilder.test.tsx`

**Interfaces:**
- Consumes: `AuthConfig`, `ExtractRow`, `KeyValueRow`, `QuestionRow` from `../types`; `KeyValueRows` from `./KeyValueRows` (Task 5); `ExtractEditor`, `QuestionsEditor` from `./ExtractEditor`/`./QuestionsEditor` (Task 6).
- Produces: `RequestBuilderProps` (exported) and `RequestBuilder(props: RequestBuilderProps)` — Method/URL fields plus **one tabbed sub-panel** (Params | Headers | Auth | Body | Extract | Questions), matching the approved layout mockup exactly (a single tab bar, not six always-visible sections). Consumed by `App` (Task 10), which no longer renders `ExtractEditor`/`QuestionsEditor` directly — they're reached through this component's tabs.

- [ ] **Step 1: Write failing tests**

Create `packages/web/test/components/RequestBuilder.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestBuilder, type RequestBuilderProps } from '../../src/components/RequestBuilder';
import type { AuthConfig } from '../../src/types';

function baseProps(overrides: Partial<RequestBuilderProps> = {}): RequestBuilderProps {
  return {
    method: 'GET',
    onMethodChange: vi.fn(),
    url: '',
    onUrlChange: vi.fn(),
    params: [],
    onParamsChange: vi.fn(),
    headers: [],
    onHeadersChange: vi.fn(),
    auth: { type: 'none' } as AuthConfig,
    onAuthChange: vi.fn(),
    body: '',
    onBodyChange: vi.fn(),
    extracts: [],
    onExtractsChange: vi.fn(),
    questions: [],
    onQuestionsChange: vi.fn(),
    ...overrides,
  };
}

describe('RequestBuilder', () => {
  it('calls onMethodChange when the method select changes', async () => {
    const onMethodChange = vi.fn();
    render(<RequestBuilder {...baseProps({ onMethodChange })} />);
    await userEvent.selectOptions(screen.getByLabelText('Method'), 'POST');
    expect(onMethodChange).toHaveBeenCalledWith('POST');
  });

  it('calls onUrlChange as the URL input changes', async () => {
    const onUrlChange = vi.fn();
    render(<RequestBuilder {...baseProps({ onUrlChange })} />);
    await userEvent.type(screen.getByLabelText('URL'), 'x');
    expect(onUrlChange).toHaveBeenCalledWith('x');
  });

  it('shows the Params tab by default', () => {
    render(<RequestBuilder {...baseProps({ params: [{ id: '1', key: 'page', value: '2' }] })} />);
    expect(screen.getByDisplayValue('page')).toBeInTheDocument();
  });

  it('switches to the Headers tab', async () => {
    render(<RequestBuilder {...baseProps({ headers: [{ id: '1', key: 'X-Trace', value: 'abc' }] })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Headers' }));
    expect(screen.getByDisplayValue('X-Trace')).toBeInTheDocument();
  });

  it('switches to the Auth tab and shows the token field for bearer auth', async () => {
    render(<RequestBuilder {...baseProps({ auth: { type: 'bearer', token: 'abc' } })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Auth' }));
    expect(screen.getByLabelText('Token')).toHaveValue('abc');
  });

  it('switches auth type via the Type select, resetting to a blank config', async () => {
    const onAuthChange = vi.fn();
    render(<RequestBuilder {...baseProps({ onAuthChange })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Auth' }));
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'basic');
    expect(onAuthChange).toHaveBeenCalledWith({ type: 'basic', username: '', password: '' });
  });

  it('switches to the Body tab and calls onBodyChange as the textarea changes', async () => {
    const onBodyChange = vi.fn();
    render(<RequestBuilder {...baseProps({ onBodyChange })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Body' }));
    await userEvent.type(screen.getByLabelText('Body (JSON)'), '{');
    expect(onBodyChange).toHaveBeenCalledWith('{');
  });

  it('switches to the Extract tab and renders ExtractEditor rows', async () => {
    render(
      <RequestBuilder
        {...baseProps({ extracts: [{ id: '1', source: 'status', path: '', rememberAs: 'code' }] })}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Extract' }));
    expect(screen.getByDisplayValue('code')).toBeInTheDocument();
  });

  it('switches to the Questions tab and renders QuestionsEditor rows', async () => {
    render(
      <RequestBuilder
        {...baseProps({ questions: [{ id: '1', source: 'status', path: '', expected: '200' }] })}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Questions' }));
    expect(screen.getByLabelText('Expected value')).toHaveValue('200');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `../../src/components/RequestBuilder` does not exist.

- [ ] **Step 3: Implement `RequestBuilder`**

Create `packages/web/src/components/RequestBuilder.tsx`:

```tsx
import { useState } from 'react';
import type { AuthConfig, ExtractRow, KeyValueRow, QuestionRow } from '../types';
import { KeyValueRows } from './KeyValueRows';
import { ExtractEditor } from './ExtractEditor';
import { QuestionsEditor } from './QuestionsEditor';

export interface RequestBuilderProps {
  method: string;
  onMethodChange: (method: string) => void;
  url: string;
  onUrlChange: (url: string) => void;
  params: KeyValueRow[];
  onParamsChange: (rows: KeyValueRow[]) => void;
  headers: KeyValueRow[];
  onHeadersChange: (rows: KeyValueRow[]) => void;
  auth: AuthConfig;
  onAuthChange: (auth: AuthConfig) => void;
  body: string;
  onBodyChange: (body: string) => void;
  extracts: ExtractRow[];
  onExtractsChange: (rows: ExtractRow[]) => void;
  questions: QuestionRow[];
  onQuestionsChange: (rows: QuestionRow[]) => void;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const AUTH_TYPES = ['none', 'bearer', 'apiKey', 'basic'] as const;

type RequestTab = 'params' | 'headers' | 'auth' | 'body' | 'extract' | 'questions';

const TABS: { id: RequestTab; label: string }[] = [
  { id: 'params', label: 'Params' },
  { id: 'headers', label: 'Headers' },
  { id: 'auth', label: 'Auth' },
  { id: 'body', label: 'Body' },
  { id: 'extract', label: 'Extract' },
  { id: 'questions', label: 'Questions' },
];

function blankAuth(type: (typeof AUTH_TYPES)[number]): AuthConfig {
  switch (type) {
    case 'none':
      return { type: 'none' };
    case 'bearer':
      return { type: 'bearer', token: '' };
    case 'apiKey':
      return { type: 'apiKey', header: '', value: '' };
    case 'basic':
      return { type: 'basic', username: '', password: '' };
  }
}

export function RequestBuilder(props: RequestBuilderProps) {
  const {
    method,
    onMethodChange,
    url,
    onUrlChange,
    params,
    onParamsChange,
    headers,
    onHeadersChange,
    auth,
    onAuthChange,
    body,
    onBodyChange,
    extracts,
    onExtractsChange,
    questions,
    onQuestionsChange,
  } = props;

  const [tab, setTab] = useState<RequestTab>('params');

  return (
    <section>
      <h2>Request</h2>
      <label>
        Method
        <select value={method} onChange={(e) => onMethodChange(e.target.value)}>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label>
        URL
        <input value={url} onChange={(e) => onUrlChange(e.target.value)} />
      </label>

      <nav>
        {TABS.map(({ id, label }) => (
          <button key={id} type="button" aria-current={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'params' && <KeyValueRows label="Params" rows={params} onChange={onParamsChange} />}
      {tab === 'headers' && <KeyValueRows label="Headers" rows={headers} onChange={onHeadersChange} />}
      {tab === 'auth' && (
        <fieldset>
          <legend>Auth</legend>
          <label>
            Type
            <select
              value={auth.type}
              onChange={(e) => onAuthChange(blankAuth(e.target.value as (typeof AUTH_TYPES)[number]))}
            >
              {AUTH_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          {auth.type === 'bearer' && (
            <label>
              Token
              <input
                value={auth.token}
                onChange={(e) => onAuthChange({ type: 'bearer', token: e.target.value })}
              />
            </label>
          )}
          {auth.type === 'apiKey' && (
            <>
              <label>
                Header
                <input
                  value={auth.header}
                  onChange={(e) => onAuthChange({ type: 'apiKey', header: e.target.value, value: auth.value })}
                />
              </label>
              <label>
                Value
                <input
                  value={auth.value}
                  onChange={(e) => onAuthChange({ type: 'apiKey', header: auth.header, value: e.target.value })}
                />
              </label>
            </>
          )}
          {auth.type === 'basic' && (
            <>
              <label>
                Username
                <input
                  value={auth.username}
                  onChange={(e) =>
                    onAuthChange({ type: 'basic', username: e.target.value, password: auth.password })
                  }
                />
              </label>
              <label>
                Password
                <input
                  value={auth.password}
                  onChange={(e) =>
                    onAuthChange({ type: 'basic', username: auth.username, password: e.target.value })
                  }
                />
              </label>
            </>
          )}
        </fieldset>
      )}
      {tab === 'body' && (
        <label>
          Body (JSON)
          <textarea value={body} onChange={(e) => onBodyChange(e.target.value)} />
        </label>
      )}
      {tab === 'extract' && <ExtractEditor rows={extracts} onChange={onExtractsChange} />}
      {tab === 'questions' && <QuestionsEditor rows={questions} onChange={onQuestionsChange} />}
    </section>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/components/RequestBuilder.tsx packages/web/test/components/RequestBuilder.test.tsx
git commit -m "feat(web): add tabbed RequestBuilder component"
```

---

### Task 8: `ResultsPanel` component

**Files:**
- Create: `packages/web/src/components/ResultsPanel.tsx`
- Test: `packages/web/test/components/ResultsPanel.test.tsx`

**Interfaces:**
- Consumes: `DerivedResults` from `../results` (Task 4).
- Produces: `ResultsPanel({ results: DerivedResults | null })`. Consumed by `App` (Task 10).

- [ ] **Step 1: Write failing tests**

Create `packages/web/test/components/ResultsPanel.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResultsPanel } from '../../src/components/ResultsPanel';
import type { DerivedResults } from '../../src/results';

const sampleResults: DerivedResults = {
  response: { status: 201, headers: { 'content-type': 'application/json' }, body: { data: { paymentId: 'pay_1' } } },
  savedValues: { paymentId: 'pay_1' },
  context: { baseUrl: 'https://api.example.com', paymentId: 'pay_1' },
  logs: ['interaction request → passed', 'question status → passed'],
};

describe('ResultsPanel', () => {
  it('shows a placeholder before any run has happened', () => {
    render(<ResultsPanel results={null} />);
    expect(screen.getByText('No run yet.')).toBeInTheDocument();
  });

  it('shows the response status by default', () => {
    render(<ResultsPanel results={sampleResults} />);
    expect(screen.getByText('Status: 201')).toBeInTheDocument();
  });

  it('switches to the Saved Values tab', async () => {
    render(<ResultsPanel results={sampleResults} />);
    await userEvent.click(screen.getByRole('button', { name: 'Saved Values' }));
    expect(screen.getByText(/paymentId/)).toBeInTheDocument();
  });

  it('switches to the Logs tab', async () => {
    render(<ResultsPanel results={sampleResults} />);
    await userEvent.click(screen.getByRole('button', { name: 'Logs' }));
    expect(screen.getByText('interaction request → passed')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `../../src/components/ResultsPanel` does not exist.

- [ ] **Step 3: Implement `ResultsPanel`**

Create `packages/web/src/components/ResultsPanel.tsx`:

```tsx
import { useState } from 'react';
import type { DerivedResults } from '../results';

type Tab = 'response' | 'savedValues' | 'context' | 'logs';

interface ResultsPanelProps {
  results: DerivedResults | null;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'response', label: 'Response' },
  { id: 'savedValues', label: 'Saved Values' },
  { id: 'context', label: 'Context' },
  { id: 'logs', label: 'Logs' },
];

export function ResultsPanel({ results }: ResultsPanelProps) {
  const [tab, setTab] = useState<Tab>('response');

  if (!results) {
    return <p>No run yet.</p>;
  }

  return (
    <section>
      <nav>
        {TABS.map(({ id, label }) => (
          <button key={id} type="button" aria-current={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      {tab === 'response' && (
        <div>
          {results.response ? (
            <>
              <p>Status: {results.response.status}</p>
              <pre>{JSON.stringify(results.response.headers, null, 2)}</pre>
              <pre>{JSON.stringify(results.response.body, null, 2)}</pre>
            </>
          ) : (
            <p>No response yet.</p>
          )}
        </div>
      )}
      {tab === 'savedValues' && <pre>{JSON.stringify(results.savedValues, null, 2)}</pre>}
      {tab === 'context' && <pre>{JSON.stringify(results.context, null, 2)}</pre>}
      {tab === 'logs' && (
        <ul>
          {results.logs.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/components/ResultsPanel.tsx packages/web/test/components/ResultsPanel.test.tsx
git commit -m "feat(web): add ResultsPanel component"
```

---

### Task 9: `RunButton` component

**Files:**
- Create: `packages/web/src/components/RunButton.tsx`
- Test: `packages/web/test/components/RunButton.test.tsx`

**Interfaces:**
- Consumes: `buildTestDefinition` from `../dsl` (Task 3); `RunEvent` type from `@ai-native-testing/engine`; `FormState` from `../types`.
- Produces: `RunButton({ form: FormState; disabled: boolean; onRunStart: () => void; onEvent: (event: RunEvent) => void; onError: (message: string) => void })`. Consumed by `App` (Task 10).

- [ ] **Step 1: Write failing tests**

Create `packages/web/test/components/RunButton.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `../../src/components/RunButton` does not exist.

- [ ] **Step 3: Implement `RunButton`**

Create `packages/web/src/components/RunButton.tsx`:

```tsx
import type { RunEvent } from '@ai-native-testing/engine';
import { buildTestDefinition } from '../dsl';
import type { FormState } from '../types';

interface RunButtonProps {
  form: FormState;
  disabled: boolean;
  onRunStart: () => void;
  onEvent: (event: RunEvent) => void;
  onError: (message: string) => void;
}

export function RunButton({ form, disabled, onRunStart, onEvent, onError }: RunButtonProps) {
  async function handleClick() {
    onRunStart();

    let definition;
    try {
      definition = buildTestDefinition(form);
    } catch (err) {
      onError(`Invalid request: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    let jobId: string;
    try {
      const response = await fetch('/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(definition),
      });
      if (!response.ok) {
        const body = await response.json();
        onError(`Could not start run: ${JSON.stringify(body)}`);
        return;
      }
      const body = (await response.json()) as { jobId: string };
      jobId = body.jobId;
    } catch (err) {
      onError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const source = new EventSource(`/runs/${jobId}/events`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as RunEvent;
      onEvent(event);
      if (event.type === 'run:completed' || event.type === 'run:failed') {
        source.close();
      }
    };
    source.onerror = () => {
      onError('Connection lost — partial results shown below.');
      source.close();
    };
  }

  return (
    <button type="button" onClick={handleClick} disabled={disabled}>
      Run
    </button>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/components/RunButton.tsx packages/web/test/components/RunButton.test.tsx
git commit -m "feat(web): add RunButton component"
```

---

### Task 10: `App` — full composition

**Files:**
- Create: `packages/web/src/components/ScreenplayHeader.tsx`
- Modify: `packages/web/src/App.tsx` (replaces the Task 2 placeholder entirely)
- Modify: `packages/web/test/App.test.tsx` (replaces the Task 2 placeholder entirely)

**Interfaces:**
- Consumes: everything from Tasks 3–9 — `FormState`/types (`./types`), `buildTestDefinition` (`./dsl`, via `RunButton`), `deriveResults` (`./results`), `KeyValueRows`, `RequestBuilder` (which now also takes `extracts`/`onExtractsChange`/`questions`/`onQuestionsChange`, rendering `ExtractEditor`/`QuestionsEditor` internally as two of its own tabs — `App` does not import those two directly), `RunButton`, `ResultsPanel`, and the new `ScreenplayHeader`.
- Produces: the complete, real `App` — the final deliverable of this sub-project.

- [ ] **Step 1: Write a failing test for `ScreenplayHeader`**

Create `packages/web/test/components/ScreenplayHeader.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScreenplayHeader } from '../../src/components/ScreenplayHeader';

describe('ScreenplayHeader', () => {
  it('calls onActorNameChange and onTaskNameChange as their inputs change', async () => {
    const onActorNameChange = vi.fn();
    const onTaskNameChange = vi.fn();
    render(
      <ScreenplayHeader
        actorName=""
        onActorNameChange={onActorNameChange}
        taskName=""
        onTaskNameChange={onTaskNameChange}
      />
    );
    await userEvent.type(screen.getByLabelText('Actor'), 'A');
    await userEvent.type(screen.getByLabelText('Task'), 'T');
    expect(onActorNameChange).toHaveBeenCalledWith('A');
    expect(onTaskNameChange).toHaveBeenCalledWith('T');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `../../src/components/ScreenplayHeader` does not exist.

- [ ] **Step 3: Implement `ScreenplayHeader`**

Create `packages/web/src/components/ScreenplayHeader.tsx`:

```tsx
interface ScreenplayHeaderProps {
  actorName: string;
  onActorNameChange: (value: string) => void;
  taskName: string;
  onTaskNameChange: (value: string) => void;
}

export function ScreenplayHeader({
  actorName,
  onActorNameChange,
  taskName,
  onTaskNameChange,
}: ScreenplayHeaderProps) {
  return (
    <section>
      <label>
        Actor
        <input value={actorName} onChange={(e) => onActorNameChange(e.target.value)} />
      </label>
      <label>
        Task
        <input value={taskName} onChange={(e) => onTaskNameChange(e.target.value)} />
      </label>
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS.

- [ ] **Step 5: Write a failing end-to-end test for the real `App`**

Replace the entire contents of `packages/web/test/App.test.tsx` with:

```tsx
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
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — the placeholder `App` has no Task/URL inputs and no Run button.

- [ ] **Step 7: Implement the real `App`**

Replace the entire contents of `packages/web/src/App.tsx` with:

```tsx
import { useState } from 'react';
import type { RunEvent, StepResult } from '@ai-native-testing/engine';
import type { FormState } from './types';
import { deriveResults, type DerivedResults } from './results';
import { ScreenplayHeader } from './components/ScreenplayHeader';
import { KeyValueRows } from './components/KeyValueRows';
import { RequestBuilder } from './components/RequestBuilder';
import { RunButton } from './components/RunButton';
import { ResultsPanel } from './components/ResultsPanel';

function initialForm(): FormState {
  return {
    actorName: '',
    taskName: '',
    variables: [],
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
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

function isFormValid(form: FormState): boolean {
  if (form.taskName.trim() === '' || form.url.trim() === '') {
    return false;
  }
  if (!isBodyValid(form.body)) {
    return false;
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

  function handleEvent(event: RunEvent) {
    if (event.type === 'step:completed' || event.type === 'step:failed') {
      setStepResults((prev) => {
        const next = [...prev];
        next[event.index] = event.result;
        return next;
      });
    }
  }

  const variablesRecord = Object.fromEntries(
    form.variables.filter((row) => row.key.trim() !== '').map((row) => [row.key, row.value])
  );

  const results: DerivedResults | null =
    stepResults.length > 0 ? deriveResults(form.extracts, variablesRecord, stepResults) : null;

  return (
    <main>
      <h1>API Runner — REST (Simple Mode)</h1>
      {error && <p role="alert">{error}</p>}
      <ScreenplayHeader
        actorName={form.actorName}
        onActorNameChange={(actorName) => setForm({ ...form, actorName })}
        taskName={form.taskName}
        onTaskNameChange={(taskName) => setForm({ ...form, taskName })}
      />
      <KeyValueRows
        label="Variables"
        rows={form.variables}
        onChange={(variables) => setForm({ ...form, variables })}
      />
      <RequestBuilder
        method={form.method}
        onMethodChange={(method) => setForm({ ...form, method })}
        url={form.url}
        onUrlChange={(url) => setForm({ ...form, url })}
        params={form.params}
        onParamsChange={(params) => setForm({ ...form, params })}
        headers={form.headers}
        onHeadersChange={(headers) => setForm({ ...form, headers })}
        auth={form.auth}
        onAuthChange={(auth) => setForm({ ...form, auth })}
        body={form.body}
        onBodyChange={(body) => setForm({ ...form, body })}
        extracts={form.extracts}
        onExtractsChange={(extracts) => setForm({ ...form, extracts })}
        questions={form.questions}
        onQuestionsChange={(questions) => setForm({ ...form, questions })}
      />
      <RunButton
        form={form}
        disabled={!isFormValid(form)}
        onRunStart={() => {
          setError(null);
          setStepResults([]);
        }}
        onEvent={handleEvent}
        onError={setError}
      />
      <ResultsPanel results={results} />
    </main>
  );
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests in `packages/web`).

- [ ] **Step 9: Typecheck, run the whole workspace, and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

Run: `pnpm test && pnpm typecheck`
Expected: PASS across all packages (`engine`, `runner-api`, `runner-log`, `server`, `web`).

```bash
git add packages/web/src/components/ScreenplayHeader.tsx packages/web/src/App.tsx packages/web/test/App.test.tsx packages/web/test/components/ScreenplayHeader.test.tsx
git commit -m "feat(web): compose the full REST Simple Mode GUI in App"
```
