# Actor/Task Dropdown with Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the REST GUI's Actor and Task text fields into comboboxes — pick a previously-used value or type a new one — with new values genuinely persisted (JSON files on the server), so they survive a server restart, not just the current page load.

**Architecture:** A tiny file-backed `NameListStore` in `packages/server` (one JSON array per resource) behind two new symmetric REST endpoints (`/actors`, `/tasks`). The GUI fetches both lists once on mount and wires each field to a native `<datalist>`; a new value is only persisted (fire-and-forget `POST`) when Run is clicked, inside `App`'s existing `onRunStart` handler — `RunButton` itself is untouched.

**Tech Stack:** Same as the rest of the project — plain Node `fs/promises` for file I/O (no database), Fastify routes, native `fetch`/`<datalist>` on the frontend, no new dependencies anywhere.

Spec: [`docs/superpowers/specs/2026-07-29-actor-task-dropdown-design.md`](../specs/2026-07-29-actor-task-dropdown-design.md)

## Global Constraints

- No new dependencies anywhere (native `fs/promises`, native `fetch`, native `<datalist>`).
- `NameListStore` dedup is exact-string-match (no case-normalization); new names are appended, never reordered or deleted.
- `packages/server/data/` (where `actors.json`/`tasks.json` live) must be gitignored — it's runtime data, not source.
- `buildApp()` gains an optional `{ dataDir?: string }` parameter; every existing zero-argument `buildApp()` call in the codebase must keep working unchanged (default `dataDir` is computed relative to the module file, not `process.cwd()`, so it doesn't depend on where the process was launched from).
- `GET /actors` / `GET /tasks` return a plain `string[]`; `POST /actors` / `POST /tasks` take `{ name: string }` and return `201 { names: string[] }`, or `400` if `name` is missing/blank. Both resources are handled identically — no special-casing between them.
- Frontend: `fetchNames` never throws — any failure (network error or non-2xx) resolves to `[]`. `saveName` is fire-and-forget — its failures are silently swallowed and never surface as an error banner or block the Run in progress.
- A new Actor/Task value is only persisted when Run is clicked (not on blur, not on every keystroke) — and only if it isn't already in that field's current option list.
- `RunButton.tsx` is not modified in this plan — the new persistence logic lives entirely in `App.tsx`'s existing `onRunStart` closure.
- Out of scope (do not implement): "Paste cURL" (separate future work), anything else from `docs/PRD_APIRunner.md` (Dashboard, Step Repository, E2E Flow Builder, Advanced Screenplay Editor, gRPC, reporting), editing/deleting a saved name, any real Actor/Task domain modeling beyond bare strings.

---

### Task 1: `NameListStore`

**Files:**
- Create: `packages/server/src/name-list-store.ts`
- Test: `packages/server/test/name-list-store.test.ts`

**Interfaces:**
- Produces: `NameListStore` class — `constructor(filePath: string)`, `list(): Promise<string[]>`, `add(name: string): Promise<string[]>`. Consumed by the routes in Task 2.

- [ ] **Step 1: Write failing tests**

Create `packages/server/test/name-list-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NameListStore } from '../src/name-list-store.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'name-list-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('NameListStore', () => {
  it('returns an empty list and creates the file when it does not exist yet', async () => {
    const store = new NameListStore(join(dir, 'actors.json'));
    expect(await store.list()).toEqual([]);

    const contents = await readFile(join(dir, 'actors.json'), 'utf8');
    expect(JSON.parse(contents)).toEqual([]);
  });

  it('adds a name and returns the updated list', async () => {
    const store = new NameListStore(join(dir, 'actors.json'));
    const result = await store.add('Authenticated Customer');
    expect(result).toEqual(['Authenticated Customer']);
    expect(await store.list()).toEqual(['Authenticated Customer']);
  });

  it('does not add a duplicate name', async () => {
    const store = new NameListStore(join(dir, 'actors.json'));
    await store.add('Admin');
    const result = await store.add('Admin');
    expect(result).toEqual(['Admin']);
  });

  it('persists across separate store instances pointed at the same file', async () => {
    const filePath = join(dir, 'actors.json');
    const first = new NameListStore(filePath);
    await first.add('Customer');

    const second = new NameListStore(filePath);
    expect(await second.list()).toEqual(['Customer']);
  });

  it('creates a nested data directory if it does not exist yet', async () => {
    const store = new NameListStore(join(dir, 'nested', 'actors.json'));
    await store.add('Customer');
    expect(await store.list()).toEqual(['Customer']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test`
Expected: FAIL — `../src/name-list-store.js` does not exist.

- [ ] **Step 3: Implement `NameListStore`**

Create `packages/server/src/name-list-store.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class NameListStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<string[]> {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      return JSON.parse(contents) as string[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.write([]);
        return [];
      }
      throw err;
    }
  }

  async add(name: string): Promise<string[]> {
    const names = await this.list();
    if (!names.includes(name)) {
      names.push(name);
      await this.write(names);
    }
    return names;
  }

  private async write(names: string[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(names, null, 2));
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test`
Expected: PASS (all tests, including the 5 new ones).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/server typecheck`
Expected: no errors.

```bash
git add packages/server/src/name-list-store.ts packages/server/test/name-list-store.test.ts
git commit -m "feat(server): add NameListStore for file-backed name persistence"
```

---

### Task 2: `/actors` and `/tasks` routes + `buildApp` wiring

**Files:**
- Create: `packages/server/src/routes/name-lists.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `.gitignore`
- Test: `packages/server/test/name-lists-routes.test.ts`

**Interfaces:**
- Consumes: `NameListStore` (Task 1).
- Produces: `registerNameListRoutes(app, actorStore, taskStore): void`. `buildApp(options?: { dataDir?: string }): FastifyInstance` — the `dataDir` option lets tests point at a temp directory instead of the real `packages/server/data`. Consumed by the frontend (Task 5, indirectly, via HTTP) and by this task's own tests directly.

- [ ] **Step 1: Write failing route tests**

Create `packages/server/test/name-lists-routes.test.ts`:

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
  dir = await mkdtemp(join(tmpdir(), 'name-lists-routes-'));
  return buildApp({ dataDir: dir });
}

describe('GET /actors', () => {
  it('returns an empty list when nothing has been saved yet', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/actors' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('POST /actors', () => {
  it('saves a new actor name and returns the updated list', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/actors', payload: { name: 'Customer' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ names: ['Customer'] });

    const list = await app.inject({ method: 'GET', url: '/actors' });
    expect(list.json()).toEqual(['Customer']);
  });

  it('rejects a blank name with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/actors', payload: { name: '  ' } });
    expect(res.statusCode).toBe(400);
  });

  it('does not duplicate an existing name', async () => {
    const app = await buildTestApp();
    await app.inject({ method: 'POST', url: '/actors', payload: { name: 'Customer' } });
    const res = await app.inject({ method: 'POST', url: '/actors', payload: { name: 'Customer' } });
    expect(res.json()).toEqual({ names: ['Customer'] });
  });
});

describe('GET /tasks and POST /tasks', () => {
  it('saves and lists a new task name', async () => {
    const app = await buildTestApp();
    await app.inject({ method: 'POST', url: '/tasks', payload: { name: 'Create Payment' } });
    const res = await app.inject({ method: 'GET', url: '/tasks' });
    expect(res.json()).toEqual(['Create Payment']);
  });

  it('rejects a blank name with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/tasks', payload: { name: '' } });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test`
Expected: FAIL — `buildApp` doesn't accept an options argument yet, and `GET /actors`/`/tasks` don't exist (404).

- [ ] **Step 3: Implement the routes**

Create `packages/server/src/routes/name-lists.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { NameListStore } from '../name-list-store.js';

export function registerNameListRoutes(
  app: FastifyInstance,
  actorStore: NameListStore,
  taskStore: NameListStore
): void {
  app.get('/actors', async () => actorStore.list());
  app.post('/actors', async (request, reply) => {
    const { name } = (request.body ?? {}) as { name?: string };
    if (!name || name.trim() === '') {
      return reply.code(400).send({ error: 'name is required' });
    }
    const names = await actorStore.add(name);
    return reply.code(201).send({ names });
  });

  app.get('/tasks', async () => taskStore.list());
  app.post('/tasks', async (request, reply) => {
    const { name } = (request.body ?? {}) as { name?: string };
    if (!name || name.trim() === '') {
      return reply.code(400).send({ error: 'name is required' });
    }
    const names = await taskStore.add(name);
    return reply.code(201).send({ names });
  });
}
```

- [ ] **Step 4: Wire `NameListStore` and the new routes into `buildApp`**

In `packages/server/src/app.ts`, change:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { RunnerRegistry } from '@ai-native-testing/engine';
import { LogRunner } from '@ai-native-testing/runner-log';
import { RestRunner } from '@ai-native-testing/runner-api';
import { JobStore } from './job-store.js';
import { registerRunRoutes } from './routes/runs.js';

export function buildApp(): FastifyInstance {
  const app = Fastify();
  const registry = new RunnerRegistry();
  registry.register(new LogRunner());
  registry.register(new RestRunner());
  const jobStore = new JobStore();

  registerRunRoutes(app, jobStore, registry);

  return app;
}
```

to:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RunnerRegistry } from '@ai-native-testing/engine';
import { LogRunner } from '@ai-native-testing/runner-log';
import { RestRunner } from '@ai-native-testing/runner-api';
import { JobStore } from './job-store.js';
import { registerRunRoutes } from './routes/runs.js';
import { NameListStore } from './name-list-store.js';
import { registerNameListRoutes } from './routes/name-lists.js';

const DEFAULT_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

export interface BuildAppOptions {
  dataDir?: string;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify();
  const registry = new RunnerRegistry();
  registry.register(new LogRunner());
  registry.register(new RestRunner());
  const jobStore = new JobStore();

  registerRunRoutes(app, jobStore, registry);

  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const actorStore = new NameListStore(join(dataDir, 'actors.json'));
  const taskStore = new NameListStore(join(dataDir, 'tasks.json'));
  registerNameListRoutes(app, actorStore, taskStore);

  return app;
}
```

Note: every existing `buildApp()` call elsewhere in the codebase (`packages/server/src/index.ts`, `packages/server/test/runs.test.ts`) keeps working unchanged — `options` defaults to `{}`, so `dataDir` falls back to `DEFAULT_DATA_DIR`.

- [ ] **Step 5: Ignore the runtime data directory**

In `.gitignore`, change:

```
.worktrees/
node_modules/
dist/
.superpowers/
```

to:

```
.worktrees/
node_modules/
dist/
.superpowers/
packages/server/data/
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test`
Expected: PASS (all tests, including the 6 new ones).

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/server typecheck`
Expected: no errors.

```bash
git add packages/server/src/routes/name-lists.ts packages/server/src/app.ts packages/server/test/name-lists-routes.test.ts .gitignore
git commit -m "feat(server): add /actors and /tasks endpoints backed by NameListStore"
```

---

### Task 3: `nameLists.ts` (frontend fetch wrapper)

**Files:**
- Create: `packages/web/src/nameLists.ts`
- Test: `packages/web/test/nameLists.test.ts`

**Interfaces:**
- Produces: `NameListEndpoint` (`'/actors' | '/tasks'`), `fetchNames(endpoint: NameListEndpoint): Promise<string[]>`, `saveName(endpoint: NameListEndpoint, name: string): void`. Consumed by `App` (Task 5).

- [ ] **Step 1: Write failing tests**

Create `packages/web/test/nameLists.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchNames, saveName } from '../src/nameLists';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchNames', () => {
  it('returns the parsed list on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(['Customer', 'Admin']) })
    );
    expect(await fetchNames('/actors')).toEqual(['Customer', 'Admin']);
  });

  it('returns an empty array when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve([]) }));
    expect(await fetchNames('/actors')).toEqual([]);
  });

  it('returns an empty array when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchNames('/tasks')).toEqual([]);
  });
});

describe('saveName', () => {
  it('POSTs the name to the given endpoint', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ names: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    saveName('/actors', 'Customer');

    expect(fetchMock).toHaveBeenCalledWith('/actors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Customer' }),
    });
  });

  it('does not throw when the request rejects', () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(() => saveName('/tasks', 'Create Payment')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `../src/nameLists` does not exist.

- [ ] **Step 3: Implement `nameLists.ts`**

Create `packages/web/src/nameLists.ts`:

```ts
export type NameListEndpoint = '/actors' | '/tasks';

export async function fetchNames(endpoint: NameListEndpoint): Promise<string[]> {
  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      return [];
    }
    return (await response.json()) as string[];
  } catch {
    return [];
  }
}

export function saveName(endpoint: NameListEndpoint, name: string): void {
  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).catch(() => {});
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including the 5 new ones).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/nameLists.ts packages/web/test/nameLists.test.ts
git commit -m "feat(web): add fetchNames/saveName for actor/task persistence"
```

---

### Task 4: `ScreenplayHeader` datalist wiring

**Files:**
- Modify: `packages/web/src/components/ScreenplayHeader.tsx`
- Modify: `packages/web/test/components/ScreenplayHeader.test.tsx`

**Interfaces:**
- Produces: `ScreenplayHeaderProps` gains two new required props, `actorOptions: string[]` and `taskOptions: string[]`. Consumed by `App` (Task 5).

- [ ] **Step 1: Write failing tests**

Replace the entire contents of `packages/web/test/components/ScreenplayHeader.test.tsx` with:

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
        actorOptions={[]}
        taskOptions={[]}
      />
    );
    await userEvent.type(screen.getByLabelText('Actor'), 'A');
    await userEvent.type(screen.getByLabelText('Task'), 'T');
    expect(onActorNameChange).toHaveBeenCalledWith('A');
    expect(onTaskNameChange).toHaveBeenCalledWith('T');
  });

  it('renders each actorOptions entry as a datalist option for the Actor field', () => {
    render(
      <ScreenplayHeader
        actorName=""
        onActorNameChange={() => {}}
        taskName=""
        onTaskNameChange={() => {}}
        actorOptions={['Customer', 'Admin']}
        taskOptions={[]}
      />
    );
    const actorInput = screen.getByLabelText('Actor');
    const listId = actorInput.getAttribute('list');
    expect(listId).toBeTruthy();
    const options = document.querySelectorAll(`#${listId} option`);
    expect(Array.from(options).map((o) => o.getAttribute('value'))).toEqual(['Customer', 'Admin']);
  });

  it('renders each taskOptions entry as a datalist option for the Task field', () => {
    render(
      <ScreenplayHeader
        actorName=""
        onActorNameChange={() => {}}
        taskName=""
        onTaskNameChange={() => {}}
        actorOptions={[]}
        taskOptions={['Create Payment', 'Get Payment Status']}
      />
    );
    const taskInput = screen.getByLabelText('Task');
    const listId = taskInput.getAttribute('list');
    expect(listId).toBeTruthy();
    const options = document.querySelectorAll(`#${listId} option`);
    expect(Array.from(options).map((o) => o.getAttribute('value'))).toEqual([
      'Create Payment',
      'Get Payment Status',
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — the first test fails on missing required props (TypeScript-level in a real build, but at runtime in Vitest it fails because `screen.getByLabelText('Actor')` won't have a `list` attribute yet in the other two tests, and `document.querySelectorAll('#null option')`/similar will find nothing).

- [ ] **Step 3: Implement the datalist wiring**

Replace the entire contents of `packages/web/src/components/ScreenplayHeader.tsx` with:

```tsx
interface ScreenplayHeaderProps {
  actorName: string;
  onActorNameChange: (value: string) => void;
  taskName: string;
  onTaskNameChange: (value: string) => void;
  actorOptions: string[];
  taskOptions: string[];
}

export function ScreenplayHeader({
  actorName,
  onActorNameChange,
  taskName,
  onTaskNameChange,
  actorOptions,
  taskOptions,
}: ScreenplayHeaderProps) {
  return (
    <section className="row">
      <label className="label">
        Actor
        <input
          className="text-input"
          list="actor-options"
          value={actorName}
          onChange={(e) => onActorNameChange(e.target.value)}
        />
        <datalist id="actor-options">
          {actorOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </label>
      <label className="label">
        Task
        <input
          className="text-input"
          list="task-options"
          value={taskName}
          onChange={(e) => onTaskNameChange(e.target.value)}
        />
        <datalist id="task-options">
          {taskOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </label>
    </section>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including the 2 new ones).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/components/ScreenplayHeader.tsx packages/web/test/components/ScreenplayHeader.test.tsx
git commit -m "feat(web): wire ScreenplayHeader Actor/Task fields to datalists"
```

---

### Task 5: `App` integration + Vite proxy

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/vite.config.ts`
- Modify: `packages/web/test/App.test.tsx`

**Interfaces:**
- Consumes: `fetchNames`, `saveName` (Task 3); `ScreenplayHeader`'s new `actorOptions`/`taskOptions` props (Task 4).
- Produces: nothing new for later tasks — this is the final integration point for this feature.

- [ ] **Step 1: Update `App.test.tsx`'s fetch mocking and add a save-on-Run test**

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

function stubNameListFetch(runsResponse: unknown = { ok: false, json: () => Promise.resolve({}) }) {
  return vi.fn((url: string) => {
    if (url === '/actors' || url === '/tasks') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    return Promise.resolve(runsResponse);
  });
}

describe('App', () => {
  beforeEach(() => {
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
    expect(
      screen.getByRole('heading', { name: 'API Runner — REST (Simple Mode)' })
    ).toBeInTheDocument();
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
});
```

Note the shared `stubNameListFetch` helper: `App` now calls `fetch('/actors')`/`fetch('/tasks')` on mount (via `fetchNames`), so every test's `fetch` mock must handle those URLs — previously a single blanket mock resolved *any* call, which would have made `fetchNames` receive a `{ jobId: 'job-1' }` object instead of a string array once this task's `App` changes land.

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `App` doesn't call `fetchNames`/`saveName` yet, so no `POST /actors`/`/tasks` calls happen; the new "saves a new Actor/Task name" test fails. The other three tests should still pass unchanged (this step is just updating test infrastructure ahead of the implementation).

- [ ] **Step 3: Implement the integration in `App`**

Replace the entire contents of `packages/web/src/App.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import type { RunEvent, StepResult } from '@ai-native-testing/engine';
import type { FormState } from './types';
import { deriveResults, type DerivedResults } from './results';
import { fetchNames, saveName } from './nameLists';
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
  const [actorOptions, setActorOptions] = useState<string[]>([]);
  const [taskOptions, setTaskOptions] = useState<string[]>([]);

  useEffect(() => {
    fetchNames('/actors').then(setActorOptions);
    fetchNames('/tasks').then(setTaskOptions);
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

  return (
    <main className="app-main">
      <h1 className="heading-xl">API Runner — REST (Simple Mode)</h1>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <ScreenplayHeader
        actorName={form.actorName}
        onActorNameChange={(actorName) => setForm({ ...form, actorName })}
        taskName={form.taskName}
        onTaskNameChange={(taskName) => setForm({ ...form, taskName })}
        actorOptions={actorOptions}
        taskOptions={taskOptions}
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
        onRunStart={handleRunStart}
        onEvent={handleEvent}
        onError={setError}
      />
      <ResultsPanel results={results} />
    </main>
  );
}
```

- [ ] **Step 4: Add `/actors` and `/tasks` to the Vite dev proxy**

In `packages/web/vite.config.ts`, change:

```ts
  server: {
    proxy: {
      '/runs': 'http://localhost:3000',
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
    },
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including the new "saves a new Actor/Task name" test).

- [ ] **Step 6: Typecheck, run the whole workspace, and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

Run: `pnpm test && pnpm typecheck`
Expected: PASS across all packages (`engine`, `runner-api`, `runner-log`, `server`, `web`).

```bash
git add packages/web/src/App.tsx packages/web/vite.config.ts packages/web/test/App.test.tsx
git commit -m "feat(web): persist new Actor/Task names on Run via /actors and /tasks"
```

---

### Task 6: Final verification

**Files:** none created or modified — this task only runs checks.

**Interfaces:** none.

- [ ] **Step 1: Run the full workspace test suite and typecheck**

Run: `pnpm test`
Expected: PASS across all 5 packages, no newly failing tests.

Run: `pnpm typecheck`
Expected: no errors in any package.

- [ ] **Step 2: Manual browser verification**

Start the backend (`pnpm --filter @ai-native-testing/server start`) and the GUI dev server (`pnpm --filter @ai-native-testing/web dev`). Open `http://localhost:5173` and confirm:

- Typing a brand-new Actor name (e.g. "Authenticated Customer"), a Task name, and a URL, then clicking Run, actually creates `packages/server/data/actors.json` and `packages/server/data/tasks.json` on disk containing those values.
- Reloading the page and clicking into the Actor/Task fields shows a native browser suggestion dropdown offering the previously-typed values.
- Selecting a suggested value still lets you run a test normally; typing something else entirely (not in the list) still works too.
- Restarting the backend process and reloading the page still shows the previously-saved values in the dropdown (proving real persistence across restarts, not just in-memory).

Take a screenshot as evidence, same as prior manual verifications in this project.

- [ ] **Step 3: Commit (if the manual check surfaced any fix)**

If Step 2 finds nothing to fix, there is nothing to commit for this task. If it does surface an issue, fix it, re-run Step 1, and commit:

```bash
git add -A
git commit -m "fix(web): correct issue found during manual Actor/Task dropdown verification"
```
