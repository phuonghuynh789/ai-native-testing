# Add to E2E Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Add to E2E Flow" button (after "Save as Reusable Step") that appends a saved Reusable Step to a named flow, plus a "Run E2E Flow" section that runs a saved flow's steps as one multi-task test, chaining variables extracted by earlier steps into later ones.

**Architecture:** A file-backed `FlowStore` in `packages/server` (name → ordered list of step names) behind three new REST endpoints (`/flows`). The frontend composes a flow into a multi-task `TestDefinition` client-side (fetching each step's saved form, building one task per step) and submits it through the *existing* `POST /runs` — no new backend run logic, since the engine already shares one `RunContext` across all tasks in a run.

**Tech Stack:** Same as the rest of the project — plain `fs/promises` for file I/O, Fastify routes, native `fetch`/`EventSource`/`<select>` on the frontend, no new dependencies anywhere.

Spec: [`docs/superpowers/specs/2026-07-30-add-to-e2e-flow-design.md`](../specs/2026-07-30-add-to-e2e-flow-design.md)

## Global Constraints

- No new dependencies anywhere.
- A flow stores an **ordered list of step names** (live references) — `{ "Transfer money by wallet": ["Check Balance", "Transfer Money", "Confirm Transfer"] }`. Not a frozen copy of step content.
- `GET /flows` returns `string[]`. `GET /flows/:name` returns that flow's ordered step names, or `404` if unknown. `POST /flows` takes `{ flowName: string, stepName: string }`, appends (creating the flow if new), returns `201 { names: string[] }`, or `400` if either field is blank.
- No new backend "run" endpoint — running a flow is composed entirely on the frontend and submitted through the existing `POST /runs`.
- A flow's `TestDefinition.actor` comes from the **first** step added to the flow — never a separate prompt, never per-task.
- A flow's `variables` are the union of every step's own `variables` rows, merged in flow order — **later steps override earlier ones** on a duplicate key.
- Each task's leaf-step count is always `2 + form.extracts.length + form.questions.length` (matches the fixed `[interaction, raw-extract, ...extracts, ...questions]` shape every saved step already has).
- "Add to E2E Flow" uses a small inline panel (two `<select>`s: Step, Flow — with a `"+ New Flow"` option revealing a name input), not native dialogs — this is the first place in the app needing two related selections at once.
- `AddToFlowButton` renders immediately after `SaveStepButton`. `FlowRunner` renders as its own new card, after the existing single-request `ResultsPanel`.
- Remember to add `/flows` to `packages/web/vite.config.ts`'s dev proxy — this exact class of omission (forgetting a new endpoint in the proxy) was found and fixed during the previous increment's manual verification; don't repeat it.
- Out of scope: editing/reordering/removing a step from a flow, deleting a flow, the PRD's full drag-and-drop canvas, non-REST node types.

---

### Task 1: `FlowStore`

**Files:**
- Create: `packages/server/src/flow-store.ts`
- Test: `packages/server/test/flow-store.test.ts`

**Interfaces:**
- Produces: `FlowStore` class — `constructor(filePath: string)`, `list(): Promise<string[]>`, `get(name: string): Promise<string[] | undefined>`, `addStep(flowName: string, stepName: string): Promise<string[]>`. Consumed by the routes in Task 2.

- [ ] **Step 1: Write failing tests**

Create `packages/server/test/flow-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FlowStore } from '../src/flow-store.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'flow-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FlowStore', () => {
  it('returns an empty list and creates the file when it does not exist yet', async () => {
    const store = new FlowStore(join(dir, 'flows.json'));
    expect(await store.list()).toEqual([]);

    const contents = await readFile(join(dir, 'flows.json'), 'utf8');
    expect(JSON.parse(contents)).toEqual({});
  });

  it('creates a new flow with one step', async () => {
    const store = new FlowStore(join(dir, 'flows.json'));
    const names = await store.addStep('Transfer money by wallet', 'Check Balance');
    expect(names).toEqual(['Transfer money by wallet']);
    expect(await store.get('Transfer money by wallet')).toEqual(['Check Balance']);
  });

  it('appends to an existing flow, preserving order', async () => {
    const store = new FlowStore(join(dir, 'flows.json'));
    await store.addStep('Transfer money by wallet', 'Check Balance');
    await store.addStep('Transfer money by wallet', 'Transfer Money');
    const names = await store.addStep('Transfer money by wallet', 'Confirm Transfer');
    expect(names).toEqual(['Transfer money by wallet']);
    expect(await store.get('Transfer money by wallet')).toEqual([
      'Check Balance',
      'Transfer Money',
      'Confirm Transfer',
    ]);
  });

  it('returns undefined for an unknown flow', async () => {
    const store = new FlowStore(join(dir, 'flows.json'));
    expect(await store.get('Missing')).toBeUndefined();
  });

  it('persists across separate store instances pointed at the same file', async () => {
    const filePath = join(dir, 'flows.json');
    const first = new FlowStore(filePath);
    await first.addStep('Login Flow', 'Login');

    const second = new FlowStore(filePath);
    expect(await second.list()).toEqual(['Login Flow']);
    expect(await second.get('Login Flow')).toEqual(['Login']);
  });

  it('creates a nested data directory if it does not exist yet', async () => {
    const store = new FlowStore(join(dir, 'nested', 'flows.json'));
    await store.addStep('Login Flow', 'Login');
    expect(await store.list()).toEqual(['Login Flow']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test`
Expected: FAIL — `../src/flow-store.js` does not exist.

- [ ] **Step 3: Implement `FlowStore`**

Create `packages/server/src/flow-store.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class FlowStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<string[]> {
    return Object.keys(await this.readMap());
  }

  async get(name: string): Promise<string[] | undefined> {
    const map = await this.readMap();
    return map[name];
  }

  async addStep(flowName: string, stepName: string): Promise<string[]> {
    const map = await this.readMap();
    const steps = map[flowName] ?? [];
    steps.push(stepName);
    map[flowName] = steps;
    await this.write(map);
    return Object.keys(map);
  }

  private async readMap(): Promise<Record<string, string[]>> {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      return JSON.parse(contents) as Record<string, string[]>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.write({});
        return {};
      }
      throw err;
    }
  }

  private async write(map: Record<string, string[]>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(map, null, 2));
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test`
Expected: PASS (all tests, including the 6 new ones).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/server typecheck`
Expected: no errors.

```bash
git add packages/server/src/flow-store.ts packages/server/test/flow-store.test.ts
git commit -m "feat(server): add FlowStore for file-backed E2E flow persistence"
```

---

### Task 2: `/flows` routes + `buildApp` wiring

**Files:**
- Create: `packages/server/src/routes/flows.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/test/flows-routes.test.ts`

**Interfaces:**
- Consumes: `FlowStore` (Task 1).
- Produces: `registerFlowRoutes(app, flowStore): void`. Consumed by the frontend (Task 4, indirectly, via HTTP) and by this task's own tests directly.

- [ ] **Step 1: Write failing route tests**

Create `packages/server/test/flows-routes.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';

let dir: string | undefined;

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

async function buildTestApp() {
  dir = await mkdtemp(join(tmpdir(), 'flows-routes-'));
  return buildApp({ dataDir: dir });
}

describe('GET /flows', () => {
  it('returns an empty list when nothing has been saved yet', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/flows' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('POST /flows', () => {
  it('creates a new flow with one step and returns the updated flow names', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/flows',
      payload: { flowName: 'Transfer money by wallet', stepName: 'Check Balance' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ names: ['Transfer money by wallet'] });
  });

  it('appends to an existing flow', async () => {
    const app = await buildTestApp();
    await app.inject({
      method: 'POST',
      url: '/flows',
      payload: { flowName: 'Transfer money by wallet', stepName: 'Check Balance' },
    });
    await app.inject({
      method: 'POST',
      url: '/flows',
      payload: { flowName: 'Transfer money by wallet', stepName: 'Transfer Money' },
    });
    const res = await app.inject({ method: 'GET', url: '/flows/Transfer%20money%20by%20wallet' });
    expect(res.json()).toEqual(['Check Balance', 'Transfer Money']);
  });

  it('rejects a blank flowName with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/flows',
      payload: { flowName: '  ', stepName: 'Check Balance' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a blank stepName with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/flows',
      payload: { flowName: 'Transfer money by wallet', stepName: '' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /flows/:name', () => {
  it('returns 404 for an unknown flow', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/flows/Missing' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test`
Expected: FAIL — `GET/POST /flows` don't exist yet (404).

- [ ] **Step 3: Implement the routes**

Create `packages/server/src/routes/flows.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { FlowStore } from '../flow-store.js';

export function registerFlowRoutes(app: FastifyInstance, flowStore: FlowStore): void {
  app.get('/flows', async () => flowStore.list());

  app.get('/flows/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const steps = await flowStore.get(name);
    if (steps === undefined) {
      return reply.code(404).send({ error: 'not found' });
    }
    return steps;
  });

  app.post('/flows', async (request, reply) => {
    const { flowName, stepName } = (request.body ?? {}) as { flowName?: string; stepName?: string };
    if (!flowName || flowName.trim() === '') {
      return reply.code(400).send({ error: 'flowName is required' });
    }
    if (!stepName || stepName.trim() === '') {
      return reply.code(400).send({ error: 'stepName is required' });
    }
    const names = await flowStore.addStep(flowName, stepName);
    return reply.code(201).send({ names });
  });
}
```

- [ ] **Step 4: Wire `FlowStore` and the new routes into `buildApp`**

In `packages/server/src/app.ts`, add the imports:

```ts
import { FlowStore } from './flow-store.js';
import { registerFlowRoutes } from './routes/flows.js';
```

right after the existing `StepStore`/`registerStepRoutes` imports, and add the wiring right after the existing `stepStore` block:

```ts
  const stepStore = new StepStore(join(dataDir, 'steps.json'));
  registerStepRoutes(app, stepStore);

  const flowStore = new FlowStore(join(dataDir, 'flows.json'));
  registerFlowRoutes(app, flowStore);

  return app;
```

(replacing the existing `return app;` that currently follows the `registerStepRoutes(app, stepStore);` line).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test`
Expected: PASS (all tests, including the 5 new ones).

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/server typecheck`
Expected: no errors.

```bash
git add packages/server/src/routes/flows.ts packages/server/src/app.ts packages/server/test/flows-routes.test.ts
git commit -m "feat(server): add /flows endpoints backed by FlowStore"
```

---

### Task 3: `dsl.ts` refactor — `buildTaskSteps` + `buildFlowDefinition`

**Files:**
- Modify: `packages/web/src/dsl.ts`
- Test: `packages/web/test/dsl.test.ts`

**Interfaces:**
- Produces: `buildTaskSteps(form: FormState): Step[]` (extracted from `buildTestDefinition`, unchanged behavior) and `buildFlowDefinition(forms: FormState[]): TestDefinition`. Consumed by `FlowRunner` (Task 6).
- `buildTestDefinition(form: FormState): TestDefinition` keeps its existing signature and behavior — all current callers/tests are unaffected.

- [ ] **Step 1: Write failing tests for `buildFlowDefinition`**

In `packages/web/test/dsl.test.ts`, add this import:

```ts
import { buildTestDefinition, buildFlowDefinition, HIDDEN_RESPONSE_VARIABLE } from '../src/dsl';
```

(replacing the existing `import { buildTestDefinition, HIDDEN_RESPONSE_VARIABLE } from '../src/dsl';`), and add this block at the end of the file, right after the closing `});` of the `describe('buildTestDefinition', ...)` block:

```ts

describe('buildFlowDefinition', () => {
  it('uses the first form as the actor and builds one task per form in order', () => {
    const definition = buildFlowDefinition([
      emptyForm({ actorName: 'Authenticated Customer', taskName: 'Check Balance' }),
      emptyForm({ actorName: 'Someone Else', taskName: 'Transfer Money' }),
    ]);
    expect(definition.actor).toEqual({ name: 'Authenticated Customer', abilities: ['rest'] });
    expect(definition.tasks.map((t) => t.name)).toEqual(['Check Balance', 'Transfer Money']);
  });

  it('merges variables from all forms, later forms overriding earlier ones on key conflict', () => {
    const definition = buildFlowDefinition([
      emptyForm({ variables: [{ id: '1', key: 'baseUrl', value: 'https://a.example.com' }] }),
      emptyForm({
        variables: [
          { id: '2', key: 'baseUrl', value: 'https://b.example.com' },
          { id: '3', key: 'orderId', value: 'order-1' },
        ],
      }),
    ]);
    expect(definition.variables).toEqual({ baseUrl: 'https://b.example.com', orderId: 'order-1' });
  });

  it('omits variables entirely when no form has any', () => {
    const definition = buildFlowDefinition([emptyForm(), emptyForm()]);
    expect(definition.variables).toBeUndefined();
  });

  it('builds the same per-task step shape as buildTestDefinition for each form', () => {
    const definition = buildFlowDefinition([
      emptyForm({
        taskName: 'Check Balance',
        extracts: [{ id: '1', source: 'jsonPath', path: '$.data.balance', rememberAs: 'balance' }],
      }),
    ]);
    expect(definition.tasks[0].steps[0].type).toBe('interaction');
    expect(definition.tasks[0].steps[1]).toEqual({
      type: 'extract',
      runner: 'rest',
      action: 'raw',
      remember: HIDDEN_RESPONSE_VARIABLE,
    });
    expect(definition.tasks[0].steps[2]).toEqual({
      type: 'extract',
      runner: 'rest',
      action: 'jsonPath',
      with: { path: '$.data.balance' },
      remember: 'balance',
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `buildFlowDefinition` is not exported from `../src/dsl`.

- [ ] **Step 3: Extract `buildTaskSteps` and add `buildFlowDefinition`**

Replace the entire contents of `packages/web/src/dsl.ts` with:

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

export function buildTaskSteps(form: FormState): Step[] {
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

  return [
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
}

export function buildTestDefinition(form: FormState): TestDefinition {
  const variables = rowsToRecord(form.variables);

  return {
    actor: { name: form.actorName, abilities: ['rest'] },
    variables: Object.keys(variables).length > 0 ? variables : undefined,
    tasks: [{ name: form.taskName, steps: buildTaskSteps(form) }],
  };
}

export function buildFlowDefinition(forms: FormState[]): TestDefinition {
  const mergedVariables: Record<string, string> = {};
  for (const form of forms) {
    Object.assign(mergedVariables, rowsToRecord(form.variables));
  }

  return {
    actor: { name: forms[0].actorName, abilities: ['rest'] },
    variables: Object.keys(mergedVariables).length > 0 ? mergedVariables : undefined,
    tasks: forms.map((form) => ({ name: form.taskName, steps: buildTaskSteps(form) })),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all `dsl.test.ts` tests, including the 4 new `buildFlowDefinition` ones — the existing `buildTestDefinition` tests must still pass unchanged).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/dsl.ts packages/web/test/dsl.test.ts
git commit -m "feat(web): extract buildTaskSteps and add buildFlowDefinition for multi-task flows"
```

---

### Task 4: `flows.ts` (frontend fetch wrapper)

**Files:**
- Create: `packages/web/src/flows.ts`
- Test: `packages/web/test/flows.test.ts`

**Interfaces:**
- Produces: `fetchFlowNames(): Promise<string[]>`, `fetchFlow(name: string): Promise<string[] | undefined>`, `addStepToFlow(flowName: string, stepName: string): Promise<string[] | undefined>`. Consumed by `AddToFlowButton`/`FlowRunner` (Tasks 5-6) and `App` (Task 7).

- [ ] **Step 1: Write failing tests**

Create `packages/web/test/flows.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchFlowNames, fetchFlow, addStepToFlow } from '../src/flows';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchFlowNames', () => {
  it('returns the parsed list on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(['Transfer money by wallet']) })
    );
    expect(await fetchFlowNames()).toEqual(['Transfer money by wallet']);
  });

  it('returns an empty array when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve([]) }));
    expect(await fetchFlowNames()).toEqual([]);
  });

  it('returns an empty array when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchFlowNames()).toEqual([]);
  });
});

describe('fetchFlow', () => {
  it('returns the parsed step names on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: () => Promise.resolve(['Check Balance', 'Transfer Money']) })
    );
    expect(await fetchFlow('Transfer money by wallet')).toEqual(['Check Balance', 'Transfer Money']);
  });

  it('returns undefined when the response is not ok (e.g. 404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await fetchFlow('Missing')).toBeUndefined();
  });

  it('returns undefined when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchFlow('Transfer money by wallet')).toBeUndefined();
  });
});

describe('addStepToFlow', () => {
  it('POSTs the flow name and step name, returning the updated flow names list', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ names: ['Transfer money by wallet'] }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await addStepToFlow('Transfer money by wallet', 'Check Balance');

    expect(fetchMock).toHaveBeenCalledWith('/flows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flowName: 'Transfer money by wallet', stepName: 'Check Balance' }),
    });
    expect(result).toEqual(['Transfer money by wallet']);
  });

  it('returns undefined when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await addStepToFlow('Transfer money by wallet', 'Check Balance')).toBeUndefined();
  });

  it('returns undefined when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await addStepToFlow('Transfer money by wallet', 'Check Balance')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `../src/flows` does not exist.

- [ ] **Step 3: Implement `flows.ts`**

Create `packages/web/src/flows.ts`:

```ts
export async function fetchFlowNames(): Promise<string[]> {
  try {
    const response = await fetch('/flows');
    if (!response.ok) {
      return [];
    }
    return (await response.json()) as string[];
  } catch {
    return [];
  }
}

export async function fetchFlow(name: string): Promise<string[] | undefined> {
  try {
    const response = await fetch(`/flows/${encodeURIComponent(name)}`);
    if (!response.ok) {
      return undefined;
    }
    return (await response.json()) as string[];
  } catch {
    return undefined;
  }
}

export async function addStepToFlow(flowName: string, stepName: string): Promise<string[] | undefined> {
  try {
    const response = await fetch('/flows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flowName, stepName }),
    });
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as { names: string[] };
    return body.names;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including the 9 new ones).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/flows.ts packages/web/test/flows.test.ts
git commit -m "feat(web): add fetchFlowNames/fetchFlow/addStepToFlow for E2E flow persistence"
```

---

### Task 5: `AddToFlowButton` component

**Files:**
- Create: `packages/web/src/components/AddToFlowButton.tsx`
- Test: `packages/web/test/components/AddToFlowButton.test.tsx`

**Interfaces:**
- Consumes: `addStepToFlow` (Task 4).
- Produces: `AddToFlowButtonProps` (`{ stepNames: string[]; flowNames: string[]; onAdded: (flowNames: string[]) => void }`). Consumed by `App` (Task 7).

- [ ] **Step 1: Write failing tests**

Create `packages/web/test/components/AddToFlowButton.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddToFlowButton } from '../../src/components/AddToFlowButton';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AddToFlowButton', () => {
  it('opens the panel when clicked', async () => {
    render(<AddToFlowButton stepNames={[]} flowNames={[]} onAdded={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add to E2E Flow' }));
    expect(screen.getByLabelText('Step')).toBeInTheDocument();
    expect(screen.getByLabelText('Flow')).toBeInTheDocument();
  });

  it('disables Add until a step and an existing flow are chosen', async () => {
    render(
      <AddToFlowButton
        stepNames={['Check Balance']}
        flowNames={['Transfer money by wallet']}
        onAdded={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add to E2E Flow' }));
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText('Step'), 'Check Balance');
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'Transfer money by wallet');
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
  });

  it('adds an existing step to an existing flow, closing the panel on success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ names: ['Transfer money by wallet'] }) });
    vi.stubGlobal('fetch', fetchMock);

    const onAdded = vi.fn();
    render(
      <AddToFlowButton
        stepNames={['Check Balance']}
        flowNames={['Transfer money by wallet']}
        onAdded={onAdded}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add to E2E Flow' }));
    await userEvent.selectOptions(screen.getByLabelText('Step'), 'Check Balance');
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'Transfer money by wallet');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(fetchMock).toHaveBeenCalledWith('/flows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flowName: 'Transfer money by wallet', stepName: 'Check Balance' }),
    });
    expect(onAdded).toHaveBeenCalledWith(['Transfer money by wallet']);
    expect(screen.queryByLabelText('Step')).not.toBeInTheDocument();
  });

  it('creates a new flow via "+ New Flow"', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ names: ['Transfer money by wallet'] }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AddToFlowButton stepNames={['Check Balance']} flowNames={[]} onAdded={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add to E2E Flow' }));
    await userEvent.selectOptions(screen.getByLabelText('Step'), 'Check Balance');
    await userEvent.selectOptions(screen.getByLabelText('Flow'), '__new_flow__');
    await userEvent.type(screen.getByLabelText('New flow name'), 'Transfer money by wallet');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/flows',
      expect.objectContaining({
        body: JSON.stringify({ flowName: 'Transfer money by wallet', stepName: 'Check Balance' }),
      })
    );
  });

  it('cancels without adding', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AddToFlowButton
        stepNames={['Check Balance']}
        flowNames={['Transfer money by wallet']}
        onAdded={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add to E2E Flow' }));
    await userEvent.selectOptions(screen.getByLabelText('Step'), 'Check Balance');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Step')).not.toBeInTheDocument();
  });

  it('alerts on failure without closing the panel', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));

    render(
      <AddToFlowButton
        stepNames={['Check Balance']}
        flowNames={['Transfer money by wallet']}
        onAdded={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add to E2E Flow' }));
    await userEvent.selectOptions(screen.getByLabelText('Step'), 'Check Balance');
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'Transfer money by wallet');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(window.alert).toHaveBeenCalledWith('Could not add this step to the flow. Please try again.');
    expect(screen.getByLabelText('Step')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `../../src/components/AddToFlowButton` does not exist.

- [ ] **Step 3: Implement `AddToFlowButton`**

Create `packages/web/src/components/AddToFlowButton.tsx`:

```tsx
import { useState } from 'react';
import { addStepToFlow } from '../flows';

export interface AddToFlowButtonProps {
  stepNames: string[];
  flowNames: string[];
  onAdded: (flowNames: string[]) => void;
}

const NEW_FLOW_OPTION = '__new_flow__';

export function AddToFlowButton({ stepNames, flowNames, onAdded }: AddToFlowButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedStep, setSelectedStep] = useState('');
  const [selectedFlow, setSelectedFlow] = useState('');
  const [newFlowName, setNewFlowName] = useState('');

  function resolvedFlowName(): string {
    return selectedFlow === NEW_FLOW_OPTION ? newFlowName.trim() : selectedFlow;
  }

  function reset() {
    setSelectedStep('');
    setSelectedFlow('');
    setNewFlowName('');
  }

  async function handleAdd() {
    const flowName = resolvedFlowName();
    const names = await addStepToFlow(flowName, selectedStep);
    if (names) {
      onAdded(names);
      reset();
      setIsOpen(false);
    } else {
      window.alert('Could not add this step to the flow. Please try again.');
    }
  }

  if (!isOpen) {
    return (
      <button type="button" className="btn-secondary" onClick={() => setIsOpen(true)}>
        Add to E2E Flow
      </button>
    );
  }

  const canAdd = selectedStep !== '' && resolvedFlowName() !== '';

  return (
    <fieldset className="card">
      <legend className="heading-sm">Add to E2E Flow</legend>
      <label className="label">
        Step
        <select
          className="text-input"
          value={selectedStep}
          onChange={(e) => setSelectedStep(e.target.value)}
        >
          <option value="" disabled>
            — Select a step —
          </option>
          {stepNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="label">
        Flow
        <select
          className="text-input"
          value={selectedFlow}
          onChange={(e) => setSelectedFlow(e.target.value)}
        >
          <option value="" disabled>
            — Select a flow —
          </option>
          {flowNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          <option value={NEW_FLOW_OPTION}>+ New Flow</option>
        </select>
      </label>
      {selectedFlow === NEW_FLOW_OPTION && (
        <label className="label">
          New flow name
          <input
            className="text-input"
            value={newFlowName}
            onChange={(e) => setNewFlowName(e.target.value)}
          />
        </label>
      )}
      <div className="row">
        <button type="button" className="btn-primary" disabled={!canAdd} onClick={handleAdd}>
          Add
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            reset();
            setIsOpen(false);
          }}
        >
          Cancel
        </button>
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including the 6 new ones).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/components/AddToFlowButton.tsx packages/web/test/components/AddToFlowButton.test.tsx
git commit -m "feat(web): add AddToFlowButton component"
```

---

### Task 6: `FlowRunner` + `FlowResultsPanel` components

**Files:**
- Create: `packages/web/src/components/FlowResultsPanel.tsx`
- Create: `packages/web/src/components/FlowRunner.tsx`
- Test: `packages/web/test/components/FlowResultsPanel.test.tsx`
- Test: `packages/web/test/components/FlowRunner.test.tsx`

**Interfaces:**
- Consumes: `fetchFlow` (Task 4), `fetchStep` (already exists in `steps.ts`), `buildFlowDefinition` (Task 3), `deriveResults`/`DerivedResults` (already exist in `results.ts`), `ResultsPanel` (already exists).
- Produces: `TaskResult` type (`{ name: string; status: 'pending' | 'passed' | 'failed'; results: DerivedResults }`), `FlowResultsPanelProps` (`{ taskResults: TaskResult[] | null }`), `FlowRunnerProps` (`{ flowNames: string[] }`). Both consumed by `App` (Task 7; `FlowResultsPanel` is also used internally by `FlowRunner`).

- [ ] **Step 1: Write failing tests for `FlowResultsPanel`**

Create `packages/web/test/components/FlowResultsPanel.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FlowResultsPanel, type TaskResult } from '../../src/components/FlowResultsPanel';

function taskResult(overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    name: 'Check Balance',
    status: 'passed',
    results: { response: { status: 200, headers: {}, body: {} }, savedValues: {}, context: {}, logs: [] },
    ...overrides,
  };
}

describe('FlowResultsPanel', () => {
  it('shows a placeholder when no flow has run yet', () => {
    render(<FlowResultsPanel taskResults={null} />);
    expect(screen.getByText('No flow run yet.')).toBeInTheDocument();
  });

  it('renders one row per task with its name and status', () => {
    render(
      <FlowResultsPanel
        taskResults={[
          taskResult({ name: 'Check Balance' }),
          taskResult({ name: 'Transfer Money', status: 'failed' }),
        ]}
      />
    );
    expect(screen.getByText(/Check Balance.*passed/)).toBeInTheDocument();
    expect(screen.getByText(/Transfer Money.*failed/)).toBeInTheDocument();
  });

  it('expands a row to show its full response and collapses on a second click', async () => {
    render(<FlowResultsPanel taskResults={[taskResult()]} />);
    expect(screen.queryByText('Status: 200')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText(/Check Balance.*passed/));
    expect(screen.getByText('Status: 200')).toBeInTheDocument();

    await userEvent.click(screen.getByText(/Check Balance.*passed/));
    expect(screen.queryByText('Status: 200')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `../../src/components/FlowResultsPanel` does not exist.

- [ ] **Step 3: Implement `FlowResultsPanel`**

Create `packages/web/src/components/FlowResultsPanel.tsx`:

```tsx
import { useState } from 'react';
import type { DerivedResults } from '../results';
import { ResultsPanel } from './ResultsPanel';

export interface TaskResult {
  name: string;
  status: 'pending' | 'passed' | 'failed';
  results: DerivedResults;
}

export interface FlowResultsPanelProps {
  taskResults: TaskResult[] | null;
}

function statusClassName(status: TaskResult['status']): string {
  if (status === 'passed') {
    return 'log-line log-line--passed';
  }
  if (status === 'failed') {
    return 'log-line log-line--failed';
  }
  return 'log-line log-line--muted';
}

export function FlowResultsPanel({ taskResults }: FlowResultsPanelProps) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (!taskResults) {
    return <p className="body-strong">No flow run yet.</p>;
  }

  return (
    <ul className="log-list">
      {taskResults.map((task, index) => (
        <li key={index}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setExpanded(expanded === index ? null : index)}
          >
            <span className={statusClassName(task.status)}>
              {task.name} — {task.status}
              {task.results.response ? ` (Status: ${task.results.response.status})` : ''}
            </span>
          </button>
          {expanded === index && <ResultsPanel results={task.results} />}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Write failing tests for `FlowRunner`**

Create `packages/web/test/components/FlowRunner.test.tsx`:

```tsx
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
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `../../src/components/FlowRunner` does not exist.

- [ ] **Step 6: Implement `FlowRunner`**

Create `packages/web/src/components/FlowRunner.tsx`:

```tsx
import { useState } from 'react';
import type { RunEvent, StepResult } from '@ai-native-testing/engine';
import type { FormState } from '../types';
import { deriveResults, type DerivedResults } from '../results';
import { fetchFlow } from '../flows';
import { fetchStep } from '../steps';
import { buildFlowDefinition } from '../dsl';
import { FlowResultsPanel, type TaskResult } from './FlowResultsPanel';

export interface FlowRunnerProps {
  flowNames: string[];
}

function taskStepCount(form: FormState): number {
  return 2 + form.extracts.length + form.questions.length;
}

export function FlowRunner({ flowNames }: FlowRunnerProps) {
  const [selectedFlow, setSelectedFlow] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [taskResults, setTaskResults] = useState<TaskResult[] | null>(null);

  async function handleRun() {
    setError(null);
    setTaskResults(null);

    const stepNames = await fetchFlow(selectedFlow);
    if (!stepNames || stepNames.length === 0) {
      setError('This flow has no steps to run.');
      return;
    }

    const fetchedForms = await Promise.all(stepNames.map((name) => fetchStep(name)));
    if (fetchedForms.some((form) => form === undefined)) {
      setError('Could not load one or more steps in this flow.');
      return;
    }
    const forms = fetchedForms as FormState[];

    const definition = buildFlowDefinition(forms);

    let jobId: string;
    try {
      const response = await fetch('/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(definition),
      });
      if (!response.ok) {
        const body = await response.json();
        setError(`Could not start flow run: ${JSON.stringify(body)}`);
        return;
      }
      const body = (await response.json()) as { jobId: string };
      jobId = body.jobId;
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const stepResults: (StepResult | undefined)[] = [];
    const boundaries: number[] = [];
    let offset = 0;
    for (const form of forms) {
      boundaries.push(offset);
      offset += taskStepCount(form);
    }

    function recomputeTaskResults() {
      const results: TaskResult[] = forms.map((form, taskIndex) => {
        const start = boundaries[taskIndex];
        const slice = stepResults.slice(start, start + taskStepCount(form));
        const variablesRecord = Object.fromEntries(
          form.variables.filter((row) => row.key.trim() !== '').map((row) => [row.key, row.value])
        );
        const derived: DerivedResults = deriveResults(form.extracts, variablesRecord, slice);
        const completedCount = slice.filter((r) => r !== undefined).length;
        let status: TaskResult['status'] = 'pending';
        if (completedCount === slice.length && slice.length > 0) {
          status = slice.every((r) => r?.status === 'passed') ? 'passed' : 'failed';
        } else if (slice.some((r) => r?.status === 'failed')) {
          status = 'failed';
        }
        return { name: form.taskName, status, results: derived };
      });
      setTaskResults(results);
    }

    recomputeTaskResults();

    const source = new EventSource(`/runs/${jobId}/events`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as RunEvent;
      if (event.type === 'step:completed' || event.type === 'step:failed') {
        stepResults[event.index] = event.result;
        recomputeTaskResults();
      }
      if (event.type === 'run:completed' || event.type === 'run:failed') {
        source.close();
      }
    };
    source.onerror = () => {
      setError('Connection lost — partial results shown below.');
      source.close();
    };
  }

  return (
    <section className="card">
      <h2 className="heading-md">E2E Flows</h2>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <label className="label">
        Flow
        <select
          className="text-input"
          value={selectedFlow}
          onChange={(e) => setSelectedFlow(e.target.value)}
        >
          <option value="" disabled>
            — Select a flow —
          </option>
          {flowNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn-primary" disabled={selectedFlow === ''} onClick={handleRun}>
        Run Flow
      </button>
      <FlowResultsPanel taskResults={taskResults} />
    </section>
  );
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including all new `FlowResultsPanel`/`FlowRunner` ones).

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/components/FlowResultsPanel.tsx packages/web/src/components/FlowRunner.tsx packages/web/test/components/FlowResultsPanel.test.tsx packages/web/test/components/FlowRunner.test.tsx
git commit -m "feat(web): add FlowRunner and FlowResultsPanel components"
```

---

### Task 7: `App` integration

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/test/App.test.tsx`
- Modify: `packages/web/vite.config.ts`

**Interfaces:**
- Consumes: `fetchFlowNames` (Task 4); `AddToFlowButton` (Task 5); `FlowRunner` (Task 6).
- Produces: nothing new for later tasks — this is the final integration point for this feature.

- [ ] **Step 1: Update `App.test.tsx`'s fetch stub**

In `packages/web/test/App.test.tsx`, change:

```ts
function stubNameListFetch(runsResponse: unknown = { ok: false, json: () => Promise.resolve({}) }) {
  return vi.fn((url: string) => {
    if (url === '/actors' || url === '/tasks' || url === '/steps') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    return Promise.resolve(runsResponse);
  });
}
```

to:

```ts
function stubNameListFetch(runsResponse: unknown = { ok: false, json: () => Promise.resolve({}) }) {
  return vi.fn((url: string) => {
    if (url === '/actors' || url === '/tasks' || url === '/steps' || url === '/flows') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    return Promise.resolve(runsResponse);
  });
}
```

- [ ] **Step 2: Run the tests to verify existing ones still pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS — this stub change alone shouldn't break anything, since `App` doesn't call `/flows` yet.

- [ ] **Step 3: Wire `AddToFlowButton` and `FlowRunner` into `App`**

In `packages/web/src/App.tsx`, change the imports:

```tsx
import { fetchNames, saveName } from './nameLists';
import { fetchStepNames } from './steps';
import { ScreenplayHeader } from './components/ScreenplayHeader';
import { KeyValueRows } from './components/KeyValueRows';
import { RequestBuilder } from './components/RequestBuilder';
import { RunButton } from './components/RunButton';
import { ResultsPanel } from './components/ResultsPanel';
import { SaveStepButton } from './components/SaveStepButton';
import { LoadStepSelect } from './components/LoadStepSelect';
```

to:

```tsx
import { fetchNames, saveName } from './nameLists';
import { fetchStepNames } from './steps';
import { fetchFlowNames } from './flows';
import { ScreenplayHeader } from './components/ScreenplayHeader';
import { KeyValueRows } from './components/KeyValueRows';
import { RequestBuilder } from './components/RequestBuilder';
import { RunButton } from './components/RunButton';
import { ResultsPanel } from './components/ResultsPanel';
import { SaveStepButton } from './components/SaveStepButton';
import { LoadStepSelect } from './components/LoadStepSelect';
import { AddToFlowButton } from './components/AddToFlowButton';
import { FlowRunner } from './components/FlowRunner';
```

Add `flowNames` state and fetch it on mount — change:

```tsx
  const [stepNames, setStepNames] = useState<string[]>([]);

  useEffect(() => {
    fetchNames('/actors').then(setActorOptions);
    fetchNames('/tasks').then(setTaskOptions);
    fetchStepNames().then(setStepNames);
  }, []);
```

to:

```tsx
  const [stepNames, setStepNames] = useState<string[]>([]);
  const [flowNames, setFlowNames] = useState<string[]>([]);

  useEffect(() => {
    fetchNames('/actors').then(setActorOptions);
    fetchNames('/tasks').then(setTaskOptions);
    fetchStepNames().then(setStepNames);
    fetchFlowNames().then(setFlowNames);
  }, []);
```

Add `AddToFlowButton` right after `SaveStepButton`, and `FlowRunner` right after `ResultsPanel` — change:

```tsx
      <SaveStepButton
        form={form}
        disabled={!isFormValid(form)}
        existingNames={stepNames}
        onSaved={setStepNames}
      />
      <ResultsPanel results={results} />
```

to:

```tsx
      <SaveStepButton
        form={form}
        disabled={!isFormValid(form)}
        existingNames={stepNames}
        onSaved={setStepNames}
      />
      <AddToFlowButton stepNames={stepNames} flowNames={flowNames} onAdded={setFlowNames} />
      <ResultsPanel results={results} />
      <FlowRunner flowNames={flowNames} />
```

- [ ] **Step 4: Add `/flows` to the Vite dev proxy**

In `packages/web/vite.config.ts`, change:

```ts
  server: {
    proxy: {
      '/runs': 'http://localhost:3000',
      '/actors': 'http://localhost:3000',
      '/tasks': 'http://localhost:3000',
      '/steps': 'http://localhost:3000',
    },
  },
```

to:

```ts
  server: {
    proxy: {
      '/runs': 'http://localhost:3000',
      '/actors': 'http://localhost:3000',
      '/tasks': 'http://localhost:3000',
      '/steps': 'http://localhost:3000',
      '/flows': 'http://localhost:3000',
    },
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests).

- [ ] **Step 6: Typecheck, run the whole workspace, and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

Run: `pnpm test && pnpm typecheck`
Expected: PASS across all packages (`engine`, `runner-api`, `runner-log`, `server`, `web`).

```bash
git add packages/web/src/App.tsx packages/web/test/App.test.tsx packages/web/vite.config.ts
git commit -m "feat(web): wire Add to E2E Flow and Run E2E Flow into App"
```

---

### Task 8: Final verification

**Files:** none created or modified — this task only runs checks.

**Interfaces:** none.

- [ ] **Step 1: Run the full workspace test suite and typecheck**

Run: `pnpm test`
Expected: PASS across all 5 packages, no newly failing tests.

Run: `pnpm typecheck`
Expected: no errors in any package.

- [ ] **Step 2: Manual browser verification**

Start the backend (`pnpm --filter @ai-native-testing/server start`) and the GUI dev server (`pnpm --filter @ai-native-testing/web dev`). Open the GUI and confirm, using a real chaining example against `https://jsonplaceholder.typicode.com`:

- Build a first request: Task name "Get User", `GET https://jsonplaceholder.typicode.com/users/1`, with an Extract row (`jsonPath`, `$.id`, remember as `userId`). Click "Save as Reusable Step" and save it as "Get User".
- Click "Add to E2E Flow," pick Step "Get User," choose "+ New Flow," name it "User Posts Flow," and Add.
- Build a second request: Task name "Get Posts For User", `GET https://jsonplaceholder.typicode.com/posts?userId=${userId}`. Save it as "Get Posts For User." Click "Add to E2E Flow" again, pick that step, and add it to the existing "User Posts Flow."
- In the "E2E Flows" section, select "User Posts Flow" and click "Run Flow." Confirm both tasks show as passed in the per-task checklist, and expanding "Get Posts For User" shows a response body containing posts actually filtered by the first task's extracted `userId` — proving the `${userId}` chaining across saved steps works end-to-end.
- Restarting the backend process and reloading the page still shows "User Posts Flow" in the flow selector (proving real persistence across restart, not just in-memory).

Take a screenshot as evidence, same as prior manual verifications in this project.

- [ ] **Step 3: Commit (if the manual check surfaced any fix)**

If Step 2 finds nothing to fix, there is nothing to commit for this task. If it does surface an issue, fix it, re-run Step 1, and commit:

```bash
git add -A
git commit -m "fix(web): correct issue found during manual Add/Run E2E Flow verification"
```
