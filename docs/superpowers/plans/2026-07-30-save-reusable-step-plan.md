# Save as Reusable Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Save as Reusable Step" button (right after "Run") that saves the entire current form under a name, plus a "Load Reusable Step" selector that restores a saved form — a minimal walking skeleton toward the PRD's Step Repository.

**Architecture:** A file-backed `StepStore` in `packages/server` (one JSON object mapping name → opaque content) behind three new REST endpoints (`GET /steps`, `GET /steps/:name`, `POST /steps`). The GUI fetches the name list on mount, wires `SaveStepButton` (native `prompt`/`confirm`/`alert`) to `POST /steps` with the whole current form as `content`, and `LoadStepSelect` (a `<select>`) to `GET /steps/:name`, applying the result straight into `App`'s form state.

**Tech Stack:** Same as the rest of the project — plain Node `fs/promises` for file I/O (no database), Fastify routes, native `fetch`/`window.prompt`/`window.confirm`/`window.alert` on the frontend, no new dependencies anywhere.

Spec: [`docs/superpowers/specs/2026-07-30-save-reusable-step-design.md`](../specs/2026-07-30-save-reusable-step-design.md)

## Global Constraints

- No new dependencies anywhere (native `fs/promises`, native `fetch`, native `window.prompt`/`confirm`/`alert`).
- "Add to E2E Flow" is explicitly OUT of scope for this plan — do not build any flow model, canvas, or related UI.
- Also out of scope: the richer PRD save-dialog fields (Description/Folder/Version/Owner/Tags/Save Assertion/Save Mock Data), editing/deleting a saved step, folder hierarchy, and Actor-independent step reuse. A saved step is exactly the current whole form, saved and restored as one unit.
- `packages/server/data/steps.json` lives in the already-gitignored `packages/server/data/` directory — no `.gitignore` change needed.
- `StepStore`/the `/steps` routes treat `content` as fully opaque (`unknown`) — the server has no dependency on `FormState`, which stays a `packages/web`-only type.
- `GET /steps` returns a plain `string[]` of names. `GET /steps/:name` returns the raw saved content, or `404 { error }` if not found. `POST /steps` takes `{ name: string, content: unknown }`, returns `201 { names: string[] }`, or `400 { error }` if `name` is blank or `content` is missing.
- Frontend `fetchStepNames`/`fetchStep` never throw — any failure (network error or non-2xx) resolves to `[]`/`undefined` respectively. `saveStep` resolves to `undefined` on failure (not fire-and-forget — its caller needs to know whether it worked, unlike Actor/Task's `saveName`).
- Save: empty/cancelled `window.prompt` → no-op. Existing name → `window.confirm` before overwriting; declining cancels the save. Both success and failure are reported via `window.alert`.
- Load: selecting a name applies the fetched form immediately, no confirmation. A failed fetch is a silent no-op; the select resets to its placeholder either way.
- `SaveStepButton` is disabled under the same `isFormValid(form)` check `RunButton` already uses in `App.tsx`.
- `LoadStepSelect` renders right after `ScreenplayHeader` (near the top). `SaveStepButton` renders immediately after `RunButton`.

---

### Task 1: `StepStore`

**Files:**
- Create: `packages/server/src/step-store.ts`
- Test: `packages/server/test/step-store.test.ts`

**Interfaces:**
- Produces: `StepStore` class — `constructor(filePath: string)`, `list(): Promise<string[]>`, `get(name: string): Promise<unknown | undefined>`, `save(name: string, content: unknown): Promise<string[]>`. Consumed by the routes in Task 2.

- [ ] **Step 1: Write failing tests**

Create `packages/server/test/step-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StepStore } from '../src/step-store.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'step-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('StepStore', () => {
  it('returns an empty list and creates the file when it does not exist yet', async () => {
    const store = new StepStore(join(dir, 'steps.json'));
    expect(await store.list()).toEqual([]);

    const contents = await readFile(join(dir, 'steps.json'), 'utf8');
    expect(JSON.parse(contents)).toEqual({});
  });

  it('saves and retrieves content by name', async () => {
    const store = new StepStore(join(dir, 'steps.json'));
    const names = await store.save('Create Payment', {
      method: 'POST',
      url: 'https://api.example.com/x',
    });
    expect(names).toEqual(['Create Payment']);
    expect(await store.get('Create Payment')).toEqual({
      method: 'POST',
      url: 'https://api.example.com/x',
    });
  });

  it('returns undefined for an unknown name', async () => {
    const store = new StepStore(join(dir, 'steps.json'));
    expect(await store.get('Missing')).toBeUndefined();
  });

  it('overwrites content when saving under an existing name', async () => {
    const store = new StepStore(join(dir, 'steps.json'));
    await store.save('Create Payment', { method: 'POST' });
    const names = await store.save('Create Payment', { method: 'PUT' });
    expect(names).toEqual(['Create Payment']);
    expect(await store.get('Create Payment')).toEqual({ method: 'PUT' });
  });

  it('persists across separate store instances pointed at the same file', async () => {
    const filePath = join(dir, 'steps.json');
    const first = new StepStore(filePath);
    await first.save('Login', { method: 'POST' });

    const second = new StepStore(filePath);
    expect(await second.list()).toEqual(['Login']);
    expect(await second.get('Login')).toEqual({ method: 'POST' });
  });

  it('creates a nested data directory if it does not exist yet', async () => {
    const store = new StepStore(join(dir, 'nested', 'steps.json'));
    await store.save('Login', { method: 'POST' });
    expect(await store.list()).toEqual(['Login']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test`
Expected: FAIL — `../src/step-store.js` does not exist.

- [ ] **Step 3: Implement `StepStore`**

Create `packages/server/src/step-store.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class StepStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<string[]> {
    return Object.keys(await this.readMap());
  }

  async get(name: string): Promise<unknown | undefined> {
    const map = await this.readMap();
    return map[name];
  }

  async save(name: string, content: unknown): Promise<string[]> {
    const map = await this.readMap();
    map[name] = content;
    await this.write(map);
    return Object.keys(map);
  }

  private async readMap(): Promise<Record<string, unknown>> {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      return JSON.parse(contents) as Record<string, unknown>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.write({});
        return {};
      }
      throw err;
    }
  }

  private async write(map: Record<string, unknown>): Promise<void> {
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
git add packages/server/src/step-store.ts packages/server/test/step-store.test.ts
git commit -m "feat(server): add StepStore for file-backed reusable-step persistence"
```

---

### Task 2: `/steps` routes + `buildApp` wiring

**Files:**
- Create: `packages/server/src/routes/steps.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/test/steps-routes.test.ts`

**Interfaces:**
- Consumes: `StepStore` (Task 1).
- Produces: `registerStepRoutes(app, stepStore): void`. Consumed by the frontend (Task 3, indirectly, via HTTP) and by this task's own tests directly.

- [ ] **Step 1: Write failing route tests**

Create `packages/server/test/steps-routes.test.ts`:

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
  dir = await mkdtemp(join(tmpdir(), 'steps-routes-'));
  return buildApp({ dataDir: dir });
}

describe('GET /steps', () => {
  it('returns an empty list when nothing has been saved yet', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/steps' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('POST /steps', () => {
  it('saves a step and returns the updated names list', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/steps',
      payload: { name: 'Create Payment', content: { method: 'POST', url: 'https://api.example.com/x' } },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ names: ['Create Payment'] });
  });

  it('rejects a blank name with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/steps',
      payload: { name: '  ', content: { method: 'GET' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects missing content with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/steps', payload: { name: 'Create Payment' } });
    expect(res.statusCode).toBe(400);
  });

  it('overwrites content when saving under an existing name', async () => {
    const app = await buildTestApp();
    await app.inject({
      method: 'POST',
      url: '/steps',
      payload: { name: 'Create Payment', content: { method: 'POST' } },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/steps',
      payload: { name: 'Create Payment', content: { method: 'PUT' } },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ names: ['Create Payment'] });
  });
});

describe('GET /steps/:name', () => {
  it('returns the saved content', async () => {
    const app = await buildTestApp();
    await app.inject({
      method: 'POST',
      url: '/steps',
      payload: { name: 'Create Payment', content: { method: 'POST', url: 'https://api.example.com/x' } },
    });
    const res = await app.inject({ method: 'GET', url: '/steps/Create%20Payment' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ method: 'POST', url: 'https://api.example.com/x' });
  });

  it('returns 404 for an unknown name', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/steps/Missing' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test`
Expected: FAIL — `GET/POST /steps` don't exist yet (404).

- [ ] **Step 3: Implement the routes**

Create `packages/server/src/routes/steps.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { StepStore } from '../step-store.js';

export function registerStepRoutes(app: FastifyInstance, stepStore: StepStore): void {
  app.get('/steps', async () => stepStore.list());

  app.get('/steps/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const content = await stepStore.get(name);
    if (content === undefined) {
      return reply.code(404).send({ error: 'not found' });
    }
    return content;
  });

  app.post('/steps', async (request, reply) => {
    const { name, content } = (request.body ?? {}) as { name?: string; content?: unknown };
    if (!name || name.trim() === '') {
      return reply.code(400).send({ error: 'name is required' });
    }
    if (content === undefined) {
      return reply.code(400).send({ error: 'content is required' });
    }
    const names = await stepStore.save(name, content);
    return reply.code(201).send({ names });
  });
}
```

- [ ] **Step 4: Wire `StepStore` and the new routes into `buildApp`**

In `packages/server/src/app.ts`, change:

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
import { StepStore } from './step-store.js';
import { registerStepRoutes } from './routes/steps.js';

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

  const stepStore = new StepStore(join(dataDir, 'steps.json'));
  registerStepRoutes(app, stepStore);

  return app;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test`
Expected: PASS (all tests, including the 6 new ones).

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/server typecheck`
Expected: no errors.

```bash
git add packages/server/src/routes/steps.ts packages/server/src/app.ts packages/server/test/steps-routes.test.ts
git commit -m "feat(server): add /steps endpoints backed by StepStore"
```

---

### Task 3: `steps.ts` (frontend fetch wrapper)

**Files:**
- Create: `packages/web/src/steps.ts`
- Test: `packages/web/test/steps.test.ts`

**Interfaces:**
- Produces: `fetchStepNames(): Promise<string[]>`, `fetchStep(name: string): Promise<FormState | undefined>`, `saveStep(name: string, form: FormState): Promise<string[] | undefined>`. Consumed by `SaveStepButton`/`LoadStepSelect` (Task 4) and `App` (Task 5).

- [ ] **Step 1: Write failing tests**

Create `packages/web/test/steps.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchStepNames, fetchStep, saveStep } from '../src/steps';
import type { FormState } from '../src/types';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function sampleForm(): FormState {
  return {
    actorName: 'Customer',
    taskName: 'Create Payment',
    variables: [],
    method: 'POST',
    url: 'https://api.example.com/x',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    extracts: [],
    questions: [],
  };
}

describe('fetchStepNames', () => {
  it('returns the parsed list on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(['Create Payment']) })
    );
    expect(await fetchStepNames()).toEqual(['Create Payment']);
  });

  it('returns an empty array when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve([]) }));
    expect(await fetchStepNames()).toEqual([]);
  });

  it('returns an empty array when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchStepNames()).toEqual([]);
  });
});

describe('fetchStep', () => {
  it('returns the parsed form on success', async () => {
    const form = sampleForm();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(form) }));
    expect(await fetchStep('Create Payment')).toEqual(form);
  });

  it('returns undefined when the response is not ok (e.g. 404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await fetchStep('Missing')).toBeUndefined();
  });

  it('returns undefined when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchStep('Create Payment')).toBeUndefined();
  });
});

describe('saveStep', () => {
  it('POSTs the name and form content, returning the updated names list', async () => {
    const form = sampleForm();
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ names: ['Create Payment'] }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await saveStep('Create Payment', form);

    expect(fetchMock).toHaveBeenCalledWith('/steps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Create Payment', content: form }),
    });
    expect(result).toEqual(['Create Payment']);
  });

  it('returns undefined when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await saveStep('Create Payment', sampleForm())).toBeUndefined();
  });

  it('returns undefined when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await saveStep('Create Payment', sampleForm())).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `../src/steps` does not exist.

- [ ] **Step 3: Implement `steps.ts`**

Create `packages/web/src/steps.ts`:

```ts
import type { FormState } from './types';

export async function fetchStepNames(): Promise<string[]> {
  try {
    const response = await fetch('/steps');
    if (!response.ok) {
      return [];
    }
    return (await response.json()) as string[];
  } catch {
    return [];
  }
}

export async function fetchStep(name: string): Promise<FormState | undefined> {
  try {
    const response = await fetch(`/steps/${encodeURIComponent(name)}`);
    if (!response.ok) {
      return undefined;
    }
    return (await response.json()) as FormState;
  } catch {
    return undefined;
  }
}

export async function saveStep(name: string, form: FormState): Promise<string[] | undefined> {
  try {
    const response = await fetch('/steps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content: form }),
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
git add packages/web/src/steps.ts packages/web/test/steps.test.ts
git commit -m "feat(web): add fetchStepNames/fetchStep/saveStep for reusable-step persistence"
```

---

### Task 4: `SaveStepButton` and `LoadStepSelect` components

**Files:**
- Create: `packages/web/src/components/SaveStepButton.tsx`
- Create: `packages/web/src/components/LoadStepSelect.tsx`
- Test: `packages/web/test/components/SaveStepButton.test.tsx`
- Test: `packages/web/test/components/LoadStepSelect.test.tsx`

**Interfaces:**
- Consumes: `saveStep`, `fetchStep` (Task 3).
- Produces: `SaveStepButtonProps` (`{ form: FormState; disabled: boolean; existingNames: string[]; onSaved: (names: string[]) => void }`) and `LoadStepSelectProps` (`{ stepNames: string[]; onLoad: (form: FormState) => void }`). Both consumed by `App` (Task 5).

- [ ] **Step 1: Write failing tests for both components**

Create `packages/web/test/components/SaveStepButton.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SaveStepButton } from '../../src/components/SaveStepButton';
import type { FormState } from '../../src/types';

function sampleForm(): FormState {
  return {
    actorName: '',
    taskName: 'Create Payment',
    variables: [],
    method: 'POST',
    url: 'https://api.example.com/x',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    extracts: [],
    questions: [],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SaveStepButton', () => {
  it('is disabled when disabled is true', () => {
    render(<SaveStepButton form={sampleForm()} disabled={true} existingNames={[]} onSaved={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Save as Reusable Step' })).toBeDisabled();
  });

  it('saves under a new name and calls onSaved with the updated list', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Create Payment');
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ names: ['Create Payment'] }) });
    vi.stubGlobal('fetch', fetchMock);

    const onSaved = vi.fn();
    render(<SaveStepButton form={sampleForm()} disabled={false} existingNames={[]} onSaved={onSaved} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save as Reusable Step' }));

    expect(fetchMock).toHaveBeenCalledWith('/steps', expect.objectContaining({ method: 'POST' }));
    expect(onSaved).toHaveBeenCalledWith(['Create Payment']);
    expect(window.alert).toHaveBeenCalledWith('Saved "Create Payment".');
  });

  it('does nothing when the prompt is cancelled', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<SaveStepButton form={sampleForm()} disabled={false} existingNames={[]} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save as Reusable Step' }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('confirms before overwriting an existing name, and cancels the save if declined', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Create Payment');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <SaveStepButton
        form={sampleForm()}
        disabled={false}
        existingNames={['Create Payment']}
        onSaved={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save as Reusable Step' }));

    expect(window.confirm).toHaveBeenCalledWith('"Create Payment" already exists. Overwrite it?');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('saves anyway when overwrite is confirmed', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Create Payment');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ names: ['Create Payment'] }) });
    vi.stubGlobal('fetch', fetchMock);

    const onSaved = vi.fn();
    render(
      <SaveStepButton
        form={sampleForm()}
        disabled={false}
        existingNames={['Create Payment']}
        onSaved={onSaved}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save as Reusable Step' }));

    expect(fetchMock).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(['Create Payment']);
  });

  it('alerts on failure without calling onSaved', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Create Payment');
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));

    const onSaved = vi.fn();
    render(<SaveStepButton form={sampleForm()} disabled={false} existingNames={[]} onSaved={onSaved} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save as Reusable Step' }));

    expect(onSaved).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('Could not save this step. Please try again.');
  });
});
```

Create `packages/web/test/components/LoadStepSelect.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoadStepSelect } from '../../src/components/LoadStepSelect';
import type { FormState } from '../../src/types';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function sampleForm(): FormState {
  return {
    actorName: 'Customer',
    taskName: 'Create Payment',
    variables: [],
    method: 'POST',
    url: 'https://api.example.com/x',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    extracts: [],
    questions: [],
  };
}

describe('LoadStepSelect', () => {
  it('renders each stepNames entry as an option', () => {
    render(<LoadStepSelect stepNames={['Create Payment', 'Login']} onLoad={vi.fn()} />);
    expect(screen.getByRole('option', { name: 'Create Payment' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Login' })).toBeInTheDocument();
  });

  it('fetches and applies the selected step, then resets to the placeholder', async () => {
    const form = sampleForm();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(form) }));

    const onLoad = vi.fn();
    render(<LoadStepSelect stepNames={['Create Payment']} onLoad={onLoad} />);

    const select = screen.getByLabelText('Load Reusable Step') as HTMLSelectElement;
    await userEvent.selectOptions(select, 'Create Payment');

    expect(select.value).toBe('');
    await vi.waitFor(() => expect(onLoad).toHaveBeenCalledWith(form));
  });

  it('does nothing when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));

    const onLoad = vi.fn();
    render(<LoadStepSelect stepNames={['Create Payment']} onLoad={onLoad} />);
    await userEvent.selectOptions(screen.getByLabelText('Load Reusable Step'), 'Create Payment');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onLoad).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — neither component exists yet.

- [ ] **Step 3: Implement `SaveStepButton`**

Create `packages/web/src/components/SaveStepButton.tsx`:

```tsx
import type { FormState } from '../types';
import { saveStep } from '../steps';

export interface SaveStepButtonProps {
  form: FormState;
  disabled: boolean;
  existingNames: string[];
  onSaved: (names: string[]) => void;
}

export function SaveStepButton({ form, disabled, existingNames, onSaved }: SaveStepButtonProps) {
  async function handleClick() {
    const input = window.prompt('Save as Reusable Step — enter a name:');
    if (input === null) {
      return;
    }
    const name = input.trim();
    if (name === '') {
      return;
    }
    if (existingNames.includes(name)) {
      const confirmed = window.confirm(`"${name}" already exists. Overwrite it?`);
      if (!confirmed) {
        return;
      }
    }
    const names = await saveStep(name, form);
    if (names) {
      onSaved(names);
      window.alert(`Saved "${name}".`);
    } else {
      window.alert('Could not save this step. Please try again.');
    }
  }

  return (
    <button type="button" className="btn-secondary" disabled={disabled} onClick={handleClick}>
      Save as Reusable Step
    </button>
  );
}
```

- [ ] **Step 4: Implement `LoadStepSelect`**

Create `packages/web/src/components/LoadStepSelect.tsx`:

```tsx
import type { FormState } from '../types';
import { fetchStep } from '../steps';

export interface LoadStepSelectProps {
  stepNames: string[];
  onLoad: (form: FormState) => void;
}

export function LoadStepSelect({ stepNames, onLoad }: LoadStepSelectProps) {
  return (
    <label className="label">
      Load Reusable Step
      <select
        className="text-input"
        defaultValue=""
        onChange={(e) => {
          const name = e.target.value;
          e.target.value = '';
          if (name === '') {
            return;
          }
          fetchStep(name).then((form) => {
            if (form) {
              onLoad(form);
            }
          });
        }}
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
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including the new ones for both components).

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/components/SaveStepButton.tsx packages/web/src/components/LoadStepSelect.tsx packages/web/test/components/SaveStepButton.test.tsx packages/web/test/components/LoadStepSelect.test.tsx
git commit -m "feat(web): add SaveStepButton and LoadStepSelect components"
```

---

### Task 5: `App` integration

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/test/App.test.tsx`

**Interfaces:**
- Consumes: `fetchStepNames` (Task 3); `SaveStepButton`, `LoadStepSelect` (Task 4).
- Produces: nothing new for later tasks — this is the final integration point for this feature.

- [ ] **Step 1: Update `App.test.tsx`'s fetch stub and add a save→load round-trip test**

In `packages/web/test/App.test.tsx`, change the `stubNameListFetch` helper:

```ts
function stubNameListFetch(runsResponse: unknown = { ok: false, json: () => Promise.resolve({}) }) {
  return vi.fn((url: string) => {
    if (url === '/actors' || url === '/tasks') {
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
    if (url === '/actors' || url === '/tasks' || url === '/steps') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    return Promise.resolve(runsResponse);
  });
}
```

Then add this test at the end of the `describe('App', ...)` block, right before the closing `});`:

```tsx
  it('saves a step and can load it back into the form', async () => {
    const savedSteps: Record<string, unknown> = {};
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/actors' || url === '/tasks') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url === '/steps' && !init) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(Object.keys(savedSteps)) });
      }
      if (url === '/steps' && init?.method === 'POST') {
        const { name, content } = JSON.parse(init.body as string);
        savedSteps[name] = content;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ names: Object.keys(savedSteps) }),
        });
      }
      if (url.startsWith('/steps/')) {
        const name = decodeURIComponent(url.replace('/steps/', ''));
        return Promise.resolve({ ok: true, json: () => Promise.resolve(savedSteps[name]) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'prompt').mockReturnValue('Create Payment');
    vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(<App />);

    await userEvent.type(screen.getByLabelText('Task'), 'Create Payment');
    await userEvent.type(screen.getByLabelText('URL'), 'https://api.example.com/v1/payments');

    await userEvent.click(screen.getByRole('button', { name: 'Save as Reusable Step' }));
    expect(window.alert).toHaveBeenCalledWith('Saved "Create Payment".');

    await userEvent.clear(screen.getByLabelText('Task'));
    expect(screen.getByLabelText('Task')).toHaveValue('');

    await userEvent.selectOptions(screen.getByLabelText('Load Reusable Step'), 'Create Payment');

    await vi.waitFor(() => expect(screen.getByLabelText('Task')).toHaveValue('Create Payment'));
    expect(screen.getByLabelText('URL')).toHaveValue('https://api.example.com/v1/payments');
  });
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — there is no "Save as Reusable Step" button or "Load Reusable Step" select yet. The other existing tests should still pass unchanged.

- [ ] **Step 3: Implement the integration in `App`**

In `packages/web/src/App.tsx`, change the imports:

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
```

to:

```tsx
import { useEffect, useState } from 'react';
import type { RunEvent, StepResult } from '@ai-native-testing/engine';
import type { FormState } from './types';
import { deriveResults, type DerivedResults } from './results';
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

Add `stepNames` state and fetch it on mount — change:

```tsx
  const [actorOptions, setActorOptions] = useState<string[]>([]);
  const [taskOptions, setTaskOptions] = useState<string[]>([]);

  useEffect(() => {
    fetchNames('/actors').then(setActorOptions);
    fetchNames('/tasks').then(setTaskOptions);
  }, []);
```

to:

```tsx
  const [actorOptions, setActorOptions] = useState<string[]>([]);
  const [taskOptions, setTaskOptions] = useState<string[]>([]);
  const [stepNames, setStepNames] = useState<string[]>([]);

  useEffect(() => {
    fetchNames('/actors').then(setActorOptions);
    fetchNames('/tasks').then(setTaskOptions);
    fetchStepNames().then(setStepNames);
  }, []);
```

Add `LoadStepSelect` right after `ScreenplayHeader` and `SaveStepButton` right after `RunButton` — change:

```tsx
      <ScreenplayHeader
        actorName={form.actorName}
        onActorNameChange={(actorName) => setForm((prev) => ({ ...prev, actorName }))}
        taskName={form.taskName}
        onTaskNameChange={(taskName) => setForm((prev) => ({ ...prev, taskName }))}
        actorOptions={actorOptions}
        taskOptions={taskOptions}
      />
      <KeyValueRows
```

to:

```tsx
      <ScreenplayHeader
        actorName={form.actorName}
        onActorNameChange={(actorName) => setForm((prev) => ({ ...prev, actorName }))}
        taskName={form.taskName}
        onTaskNameChange={(taskName) => setForm((prev) => ({ ...prev, taskName }))}
        actorOptions={actorOptions}
        taskOptions={taskOptions}
      />
      <LoadStepSelect stepNames={stepNames} onLoad={setForm} />
      <KeyValueRows
```

and change:

```tsx
      <RunButton
        form={form}
        disabled={!isFormValid(form)}
        onRunStart={handleRunStart}
        onEvent={handleEvent}
        onError={setError}
      />
      <ResultsPanel results={results} />
```

to:

```tsx
      <RunButton
        form={form}
        disabled={!isFormValid(form)}
        onRunStart={handleRunStart}
        onEvent={handleEvent}
        onError={setError}
      />
      <SaveStepButton
        form={form}
        disabled={!isFormValid(form)}
        existingNames={stepNames}
        onSaved={setStepNames}
      />
      <ResultsPanel results={results} />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including the new save→load round-trip test).

- [ ] **Step 5: Typecheck, run the whole workspace, and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

Run: `pnpm test && pnpm typecheck`
Expected: PASS across all packages (`engine`, `runner-api`, `runner-log`, `server`, `web`).

```bash
git add packages/web/src/App.tsx packages/web/test/App.test.tsx
git commit -m "feat(web): wire Save as Reusable Step and Load Reusable Step into App"
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

Start the backend (`pnpm --filter @ai-native-testing/server start`) and the GUI dev server (`pnpm --filter @ai-native-testing/web dev`). Open the GUI and confirm:

- Filling in Task name and URL, then clicking "Save as Reusable Step," prompts for a name; entering one creates/updates `packages/server/data/steps.json` on disk with the full form under that name.
- Saving again under the same name shows a confirm dialog; declining leaves the file unchanged, confirming overwrites it.
- Changing the form, then selecting the saved name from "Load Reusable Step," restores every field (Actor, Task, Method, URL, Params, Headers, Auth, Body, Extract, Questions) to exactly what was saved.
- Restarting the backend process and reloading the page still shows the previously-saved step in the Load dropdown (proving real persistence across restart).

Take a screenshot as evidence, same as prior manual verifications in this project.

- [ ] **Step 3: Commit (if the manual check surfaced any fix)**

If Step 2 finds nothing to fix, there is nothing to commit for this task. If it does surface an issue, fix it, re-run Step 1, and commit:

```bash
git add -A
git commit -m "fix(web): correct issue found during manual Save/Load Reusable Step verification"
```
