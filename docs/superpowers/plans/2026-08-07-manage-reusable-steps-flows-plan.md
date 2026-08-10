# Manage Reusable Steps & Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Manage Load Reusable Step" page (Sidebar entry right after "Simple Mode") with two tabs — Steps and Flows — each supporting search-by-name, 20-row server-side pagination, and delete.

**Architecture:** `StepStore`/`FlowStore` each gain `delete` and `search` methods; two new routes per resource (`GET .../search`, `DELETE .../:name`) are added alongside the existing routes without changing their contracts. A single new `ManageStepsPage` component renders both tabs, calling new `searchSteps`/`deleteStep`/`searchFlows`/`deleteFlow` client functions. Deleting a step first checks (client-side) whether any flow references it, using the already-existing `fetchFlowNames`/`fetchFlow` functions.

**Tech Stack:** Fastify (server), React + Vite + TypeScript (web), Vitest for both.

## Global Constraints

- Follow `StepStore`/`FlowStore`'s existing style exactly: private `readMap`/`write` helpers, same file-backed JSON approach. Do not introduce a database or new persistence mechanism.
- `packages/server` must never import types from `packages/web` (established boundary — `StepStore`'s saved `content` is `unknown` from the server's point of view). `StepStore.search`'s summary-extraction logic must defensively read fields from an untyped object, not assume a `FormState` shape.
- New routes go in the existing `packages/server/src/routes/steps.ts` and `packages/server/src/routes/flows.ts` files — do not create new route files.
- Do **not** add new entries to `packages/web/vite.config.ts`'s dev proxy. The existing `'/steps': 'http://localhost:3000'` and `'/flows': 'http://localhost:3000'` entries are plain strings, which Vite's dev server proxy matches by **path prefix** — `/steps/search` and `/steps/:name` (DELETE) are already covered by the `/steps` entry, and likewise for `/flows`. Confirm this holds during Task 8's manual verification rather than assuming it — this project has hit missing-proxy-entry bugs twice before for genuinely new path prefixes (not sub-paths of an existing one), so it's worth one explicit check.
- Every new store method's route must place the more specific static path (`/steps/search`) so it reads clearly next to the existing `/steps/:name` parametric route. (Fastify's underlying router already prioritizes static segments over parametric ones regardless of registration order, so this is a readability choice, not a correctness requirement — Task 2/4 include a regression test proving `/steps/search` isn't swallowed by `/steps/:name` either way.)
- TDD throughout: write the failing test, run it, confirm the failure, implement, run again, confirm the pass, typecheck, commit. This matches every prior increment in this project.
- Reuse existing CSS: the delete icon button uses the existing `.kv-remove` class (✕ glyph) verbatim, matching Params/Headers/Variables/Metadata rows elsewhere in the app. Two new CSS classes are needed: `.data-table` and `.pagination` (added in Task 6).
- Manual verification (Task 8) must use disposable test steps/flows created for that purpose — never delete any of the developer's real saved steps/flows in `packages/server/data/`.

---

### Task 1: StepStore — delete and search

**Files:**
- Modify: `packages/server/src/step-store.ts`
- Test: `packages/server/test/step-store.test.ts`

**Interfaces:**
- Produces: `export interface StepSummary { name: string; protocol: string; method: string; url: string; grpcService: string; grpcMethod: string }`, `StepStore.delete(name: string): Promise<string[] | undefined>` (mirrors `get`'s undefined-for-missing and `save`'s return-full-names-list conventions combined — undefined means "didn't exist", otherwise returns the updated name list), `StepStore.search(query: string, page: number, pageSize: number): Promise<{ items: StepSummary[]; total: number }>`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/test/step-store.test.ts`, inside the existing `describe('StepStore', ...)` block or as new sibling `describe` blocks after it:

```ts
describe('StepStore.delete', () => {
  it('deletes an existing step and returns the updated names list', async () => {
    const store = new StepStore(join(dir, 'steps.json'));
    await store.save('Create Payment', { method: 'POST' });
    await store.save('Get Payment', { method: 'GET' });
    const names = await store.delete('Create Payment');
    expect(names).toEqual(['Get Payment']);
    expect(await store.get('Create Payment')).toBeUndefined();
  });

  it('returns undefined when deleting an unknown name', async () => {
    const store = new StepStore(join(dir, 'steps.json'));
    expect(await store.delete('Missing')).toBeUndefined();
  });

  it('persists the deletion across separate store instances pointed at the same file', async () => {
    const filePath = join(dir, 'steps.json');
    const first = new StepStore(filePath);
    await first.save('Login', { method: 'POST' });
    await first.delete('Login');

    const second = new StepStore(filePath);
    expect(await second.list()).toEqual([]);
  });
});

describe('StepStore.search', () => {
  it('matches step names case-insensitively by substring', async () => {
    const store = new StepStore(join(dir, 'steps.json'));
    await store.save('Create Payment', { protocol: 'rest', method: 'POST', url: 'https://x.com' });
    await store.save('Get Payment Status', { protocol: 'rest', method: 'GET', url: 'https://x.com/status' });
    await store.save('Login', { protocol: 'rest', method: 'POST', url: 'https://x.com/login' });

    const result = await store.search('payment', 1, 20);
    expect(result.total).toBe(2);
    expect(result.items.map((i) => i.name).sort()).toEqual(['Create Payment', 'Get Payment Status']);
  });

  it('paginates results and reports the total match count', async () => {
    const store = new StepStore(join(dir, 'steps.json'));
    for (let i = 1; i <= 25; i++) {
      await store.save(`Step ${String(i).padStart(2, '0')}`, { protocol: 'rest' });
    }
    const page1 = await store.search('', 1, 20);
    expect(page1.items).toHaveLength(20);
    expect(page1.total).toBe(25);

    const page2 = await store.search('', 2, 20);
    expect(page2.items).toHaveLength(5);
    expect(page2.total).toBe(25);
  });

  it('extracts REST and gRPC summary fields correctly', async () => {
    const store = new StepStore(join(dir, 'steps.json'));
    await store.save('REST Step', { protocol: 'rest', method: 'POST', url: 'https://x.com/y' });
    await store.save('gRPC Step', { protocol: 'grpc', grpc: { service: 'UserSvc', method: 'Create' } });

    const result = await store.search('', 1, 20);
    const rest = result.items.find((i) => i.name === 'REST Step');
    const grpc = result.items.find((i) => i.name === 'gRPC Step');
    expect(rest).toEqual({
      name: 'REST Step',
      protocol: 'rest',
      method: 'POST',
      url: 'https://x.com/y',
      grpcService: '',
      grpcMethod: '',
    });
    expect(grpc).toEqual({
      name: 'gRPC Step',
      protocol: 'grpc',
      method: '',
      url: '',
      grpcService: 'UserSvc',
      grpcMethod: 'Create',
    });
  });

  it('defensively handles malformed or missing fields without throwing', async () => {
    const store = new StepStore(join(dir, 'steps.json'));
    await store.save('Weird Step', {});
    const result = await store.search('', 1, 20);
    expect(result.items[0]).toEqual({
      name: 'Weird Step',
      protocol: '',
      method: '',
      url: '',
      grpcService: '',
      grpcMethod: '',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test -- step-store.test.ts`
Expected: FAIL — `store.delete is not a function` / `store.search is not a function`.

- [ ] **Step 3: Implement `delete` and `search`**

Replace `packages/server/src/step-store.ts` in full:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface StepSummary {
  name: string;
  protocol: string;
  method: string;
  url: string;
  grpcService: string;
  grpcMethod: string;
}

function toStepSummary(name: string, content: unknown): StepSummary {
  const record = (content ?? {}) as Record<string, unknown>;
  const grpc = (record.grpc ?? {}) as Record<string, unknown>;
  return {
    name,
    protocol: typeof record.protocol === 'string' ? record.protocol : '',
    method: typeof record.method === 'string' ? record.method : '',
    url: typeof record.url === 'string' ? record.url : '',
    grpcService: typeof grpc.service === 'string' ? grpc.service : '',
    grpcMethod: typeof grpc.method === 'string' ? grpc.method : '',
  };
}

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

  async delete(name: string): Promise<string[] | undefined> {
    const map = await this.readMap();
    if (!(name in map)) {
      return undefined;
    }
    delete map[name];
    await this.write(map);
    return Object.keys(map);
  }

  async search(query: string, page: number, pageSize: number): Promise<{ items: StepSummary[]; total: number }> {
    const map = await this.readMap();
    const lowerQuery = query.toLowerCase();
    const matchingNames = Object.keys(map).filter((name) => name.toLowerCase().includes(lowerQuery));
    const total = matchingNames.length;
    const start = (page - 1) * pageSize;
    const pageNames = matchingNames.slice(start, start + pageSize);
    const items = pageNames.map((name) => toStepSummary(name, map[name]));
    return { items, total };
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test -- step-store.test.ts`
Expected: PASS (all tests, including the 5 pre-existing ones).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @ai-native-testing/server typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/step-store.ts packages/server/test/step-store.test.ts
git commit -m "feat(server): add StepStore.delete and StepStore.search"
```

---

### Task 2: Steps routes — GET /steps/search and DELETE /steps/:name

**Files:**
- Modify: `packages/server/src/routes/steps.ts`
- Test: `packages/server/test/steps-routes.test.ts`

**Interfaces:**
- Consumes: `StepStore.delete`, `StepStore.search` from Task 1.
- Produces: `GET /steps/search?search=&page=&pageSize=` → `{ items: StepSummary[], total: number }` (200); `DELETE /steps/:name` → `{ names: string[] }` (200) or `{ error: 'not found' }` (404).

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/test/steps-routes.test.ts`:

```ts
describe('GET /steps/search', () => {
  it('returns paginated, filtered results', async () => {
    const app = await buildTestApp();
    await app.inject({
      method: 'POST',
      url: '/steps',
      payload: { name: 'Create Payment', content: { protocol: 'rest', method: 'POST', url: 'https://x.com' } },
    });
    await app.inject({
      method: 'POST',
      url: '/steps',
      payload: { name: 'Login', content: { protocol: 'rest', method: 'POST', url: 'https://x.com/login' } },
    });

    const res = await app.inject({ method: 'GET', url: '/steps/search?search=payment&page=1&pageSize=20' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [
        { name: 'Create Payment', protocol: 'rest', method: 'POST', url: 'https://x.com', grpcService: '', grpcMethod: '' },
      ],
      total: 1,
    });
  });

  it('defaults to page 1 / pageSize 20 and an empty search when params are omitted', async () => {
    const app = await buildTestApp();
    await app.inject({ method: 'POST', url: '/steps', payload: { name: 'Login', content: { protocol: 'rest' } } });
    const res = await app.inject({ method: 'GET', url: '/steps/search' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [{ name: 'Login', protocol: 'rest', method: '', url: '', grpcService: '', grpcMethod: '' }],
      total: 1,
    });
  });

  it('is not shadowed by the /steps/:name route', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/steps/search' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], total: 0 });
  });
});

describe('DELETE /steps/:name', () => {
  it('deletes an existing step and returns the updated names list', async () => {
    const app = await buildTestApp();
    await app.inject({ method: 'POST', url: '/steps', payload: { name: 'Create Payment', content: { method: 'POST' } } });
    const res = await app.inject({ method: 'DELETE', url: '/steps/Create%20Payment' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ names: [] });
  });

  it('returns 404 for an unknown name', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'DELETE', url: '/steps/Missing' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test -- steps-routes.test.ts`
Expected: FAIL — 404/`FST_ERR_NOT_FOUND`-style failures for the new routes not existing yet.

- [ ] **Step 3: Implement the routes**

Replace `packages/server/src/routes/steps.ts` in full:

```ts
import type { FastifyInstance } from 'fastify';
import type { StepStore } from '../step-store.js';

export function registerStepRoutes(app: FastifyInstance, stepStore: StepStore): void {
  app.get('/steps', async () => stepStore.list());

  app.get('/steps/search', async (request) => {
    const { search, page, pageSize } = request.query as { search?: string; page?: string; pageSize?: string };
    return stepStore.search(search ?? '', Number(page) || 1, Number(pageSize) || 20);
  });

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

  app.delete('/steps/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const names = await stepStore.delete(name);
    if (names === undefined) {
      return reply.code(404).send({ error: 'not found' });
    }
    return { names };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test -- steps-routes.test.ts`
Expected: PASS (all tests, including pre-existing ones).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @ai-native-testing/server typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/steps.ts packages/server/test/steps-routes.test.ts
git commit -m "feat(server): add GET /steps/search and DELETE /steps/:name routes"
```

---

### Task 3: FlowStore — delete and search

**Files:**
- Modify: `packages/server/src/flow-store.ts`
- Test: `packages/server/test/flow-store.test.ts`

**Interfaces:**
- Produces: `export interface FlowSummary { name: string; steps: string[] }`, `FlowStore.delete(name: string): Promise<string[] | undefined>`, `FlowStore.search(query: string, page: number, pageSize: number): Promise<{ items: FlowSummary[]; total: number }>`.

- [ ] **Step 1: Write the failing tests**

Read `packages/server/test/flow-store.test.ts` first to match its existing `dir`/`beforeEach`/`afterEach` setup exactly, then append:

```ts
describe('FlowStore.delete', () => {
  it('deletes an existing flow and returns the updated names list', async () => {
    const store = new FlowStore(join(dir, 'flows.json'));
    await store.setSteps('Checkout', ['Login', 'Create Payment']);
    await store.setSteps('Refund', ['Login', 'Refund Payment']);
    const names = await store.delete('Checkout');
    expect(names).toEqual(['Refund']);
    expect(await store.get('Checkout')).toBeUndefined();
  });

  it('returns undefined when deleting an unknown name', async () => {
    const store = new FlowStore(join(dir, 'flows.json'));
    expect(await store.delete('Missing')).toBeUndefined();
  });

  it('persists the deletion across separate store instances pointed at the same file', async () => {
    const filePath = join(dir, 'flows.json');
    const first = new FlowStore(filePath);
    await first.setSteps('Checkout', ['Login']);
    await first.delete('Checkout');

    const second = new FlowStore(filePath);
    expect(await second.list()).toEqual([]);
  });
});

describe('FlowStore.search', () => {
  it('matches flow names case-insensitively by substring and includes their steps', async () => {
    const store = new FlowStore(join(dir, 'flows.json'));
    await store.setSteps('Checkout Flow', ['Login', 'Create Payment']);
    await store.setSteps('Refund Flow', ['Login', 'Refund Payment']);
    await store.setSteps('Onboarding', ['Create Account']);

    const result = await store.search('flow', 1, 20);
    expect(result.total).toBe(2);
    expect(result.items.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'Checkout Flow', steps: ['Login', 'Create Payment'] },
      { name: 'Refund Flow', steps: ['Login', 'Refund Payment'] },
    ]);
  });

  it('paginates results and reports the total match count', async () => {
    const store = new FlowStore(join(dir, 'flows.json'));
    for (let i = 1; i <= 25; i++) {
      await store.setSteps(`Flow ${String(i).padStart(2, '0')}`, []);
    }
    const page1 = await store.search('', 1, 20);
    expect(page1.items).toHaveLength(20);
    expect(page1.total).toBe(25);

    const page2 = await store.search('', 2, 20);
    expect(page2.items).toHaveLength(5);
    expect(page2.total).toBe(25);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test -- flow-store.test.ts`
Expected: FAIL — `store.delete is not a function` / `store.search is not a function`.

- [ ] **Step 3: Implement `delete` and `search`**

Replace `packages/server/src/flow-store.ts` in full:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface FlowSummary {
  name: string;
  steps: string[];
}

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

  async setSteps(flowName: string, stepNames: string[]): Promise<string[]> {
    const map = await this.readMap();
    map[flowName] = stepNames;
    await this.write(map);
    return Object.keys(map);
  }

  async delete(name: string): Promise<string[] | undefined> {
    const map = await this.readMap();
    if (!(name in map)) {
      return undefined;
    }
    delete map[name];
    await this.write(map);
    return Object.keys(map);
  }

  async search(query: string, page: number, pageSize: number): Promise<{ items: FlowSummary[]; total: number }> {
    const map = await this.readMap();
    const lowerQuery = query.toLowerCase();
    const matchingNames = Object.keys(map).filter((name) => name.toLowerCase().includes(lowerQuery));
    const total = matchingNames.length;
    const start = (page - 1) * pageSize;
    const pageNames = matchingNames.slice(start, start + pageSize);
    const items = pageNames.map((name) => ({ name, steps: map[name] }));
    return { items, total };
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test -- flow-store.test.ts`
Expected: PASS (all tests, including pre-existing ones).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @ai-native-testing/server typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/flow-store.ts packages/server/test/flow-store.test.ts
git commit -m "feat(server): add FlowStore.delete and FlowStore.search"
```

---

### Task 4: Flows routes — GET /flows/search and DELETE /flows/:name

**Files:**
- Modify: `packages/server/src/routes/flows.ts`
- Test: `packages/server/test/flows-routes.test.ts`

**Interfaces:**
- Consumes: `FlowStore.delete`, `FlowStore.search` from Task 3.
- Produces: `GET /flows/search?search=&page=&pageSize=` → `{ items: FlowSummary[], total: number }` (200); `DELETE /flows/:name` → `{ names: string[] }` (200) or `{ error: 'not found' }` (404).

- [ ] **Step 1: Write the failing tests**

Read `packages/server/test/flows-routes.test.ts` first to match its existing `buildTestApp` helper, then append:

```ts
describe('GET /flows/search', () => {
  it('returns paginated, filtered results', async () => {
    const app = await buildTestApp();
    await app.inject({
      method: 'PUT',
      url: '/flows/Checkout%20Flow',
      payload: { stepNames: ['Login', 'Create Payment'] },
    });
    await app.inject({ method: 'PUT', url: '/flows/Onboarding', payload: { stepNames: ['Create Account'] } });

    const res = await app.inject({ method: 'GET', url: '/flows/search?search=flow&page=1&pageSize=20' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [{ name: 'Checkout Flow', steps: ['Login', 'Create Payment'] }],
      total: 1,
    });
  });

  it('defaults to page 1 / pageSize 20 and an empty search when params are omitted', async () => {
    const app = await buildTestApp();
    await app.inject({ method: 'PUT', url: '/flows/Onboarding', payload: { stepNames: ['Create Account'] } });
    const res = await app.inject({ method: 'GET', url: '/flows/search' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [{ name: 'Onboarding', steps: ['Create Account'] }], total: 1 });
  });

  it('is not shadowed by the /flows/:name route', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/flows/search' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], total: 0 });
  });
});

describe('DELETE /flows/:name', () => {
  it('deletes an existing flow and returns the updated names list', async () => {
    const app = await buildTestApp();
    await app.inject({ method: 'PUT', url: '/flows/Checkout', payload: { stepNames: ['Login'] } });
    const res = await app.inject({ method: 'DELETE', url: '/flows/Checkout' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ names: [] });
  });

  it('returns 404 for an unknown name', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'DELETE', url: '/flows/Missing' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test -- flows-routes.test.ts`
Expected: FAIL for the new routes not existing yet.

- [ ] **Step 3: Implement the routes**

Replace `packages/server/src/routes/flows.ts` in full:

```ts
import type { FastifyInstance } from 'fastify';
import type { FlowStore } from '../flow-store.js';

export function registerFlowRoutes(app: FastifyInstance, flowStore: FlowStore): void {
  app.get('/flows', async () => flowStore.list());

  app.get('/flows/search', async (request) => {
    const { search, page, pageSize } = request.query as { search?: string; page?: string; pageSize?: string };
    return flowStore.search(search ?? '', Number(page) || 1, Number(pageSize) || 20);
  });

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

  app.put('/flows/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const { stepNames } = (request.body ?? {}) as { stepNames?: unknown };
    if (!Array.isArray(stepNames)) {
      return reply.code(400).send({ error: 'stepNames is required' });
    }
    const names = await flowStore.setSteps(name, stepNames as string[]);
    return reply.code(200).send({ names });
  });

  app.delete('/flows/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const names = await flowStore.delete(name);
    if (names === undefined) {
      return reply.code(404).send({ error: 'not found' });
    }
    return { names };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test -- flows-routes.test.ts`
Expected: PASS (all tests, including pre-existing ones).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @ai-native-testing/server typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/flows.ts packages/server/test/flows-routes.test.ts
git commit -m "feat(server): add GET /flows/search and DELETE /flows/:name routes"
```

---

### Task 5: Web client functions — searchSteps/deleteStep, searchFlows/deleteFlow

**Files:**
- Modify: `packages/web/src/steps.ts`
- Modify: `packages/web/src/flows.ts`
- Test: `packages/web/test/steps.test.ts`
- Test: `packages/web/test/flows.test.ts`

**Interfaces:**
- Produces: `export interface StepSummary { name: string; protocol: string; method: string; url: string; grpcService: string; grpcMethod: string }`, `export interface StepSearchResult { items: StepSummary[]; total: number }`, `searchSteps(query: string, page: number, pageSize: number): Promise<StepSearchResult>`, `deleteStep(name: string): Promise<string[] | undefined>`.
- Produces: `export interface FlowSummary { name: string; steps: string[] }`, `export interface FlowSearchResult { items: FlowSummary[]; total: number }`, `searchFlows(query: string, page: number, pageSize: number): Promise<FlowSearchResult>`, `deleteFlow(name: string): Promise<string[] | undefined>`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/web/test/steps.test.ts` (after the existing `describe('saveStep', ...)` block):

```ts
describe('searchSteps', () => {
  it('sends search/page/pageSize as query params and returns the parsed result', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [], total: 0 }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchSteps('payment', 2, 20);

    expect(fetchMock).toHaveBeenCalledWith('/steps/search?search=payment&page=2&pageSize=20');
    expect(result).toEqual({ items: [], total: 0 });
  });

  it('returns an empty result when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await searchSteps('', 1, 20)).toEqual({ items: [], total: 0 });
  });

  it('returns an empty result when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await searchSteps('', 1, 20)).toEqual({ items: [], total: 0 });
  });
});

describe('deleteStep', () => {
  it('sends a DELETE request and returns the updated names list', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ names: ['Login'] }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await deleteStep('Create Payment');

    expect(fetchMock).toHaveBeenCalledWith('/steps/Create%20Payment', { method: 'DELETE' });
    expect(result).toEqual(['Login']);
  });

  it('returns undefined when the response is not ok (e.g. 404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await deleteStep('Missing')).toBeUndefined();
  });

  it('returns undefined when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await deleteStep('Create Payment')).toBeUndefined();
  });
});
```

Also add `searchSteps, deleteStep` to the existing `import { fetchStepNames, fetchStep, saveStep } from '../src/steps';` line.

`packages/web/test/flows.test.ts` already exists (tests for `fetchFlowNames`/`fetchFlow`/`addStepToFlow`/`setFlow`). Update its import line to `import { fetchFlowNames, fetchFlow, addStepToFlow, setFlow, searchFlows, deleteFlow } from '../src/flows';` and append two new `describe` blocks at the end of the file:

```ts
describe('searchFlows', () => {
  it('sends search/page/pageSize as query params and returns the parsed result', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [], total: 0 }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchFlows('checkout', 1, 20);

    expect(fetchMock).toHaveBeenCalledWith('/flows/search?search=checkout&page=1&pageSize=20');
    expect(result).toEqual({ items: [], total: 0 });
  });

  it('returns an empty result when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await searchFlows('', 1, 20)).toEqual({ items: [], total: 0 });
  });

  it('returns an empty result when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await searchFlows('', 1, 20)).toEqual({ items: [], total: 0 });
  });
});

describe('deleteFlow', () => {
  it('sends a DELETE request and returns the updated names list', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ names: ['Onboarding'] }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await deleteFlow('Checkout Flow');

    expect(fetchMock).toHaveBeenCalledWith('/flows/Checkout%20Flow', { method: 'DELETE' });
    expect(result).toEqual(['Onboarding']);
  });

  it('returns undefined when the response is not ok (e.g. 404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await deleteFlow('Missing')).toBeUndefined();
  });

  it('returns undefined when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await deleteFlow('Checkout Flow')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- steps.test.ts flows.test.ts`
Expected: FAIL — `searchSteps`/`deleteStep`/`searchFlows`/`deleteFlow` are not exported.

- [ ] **Step 3: Implement the client functions**

In `packages/web/src/steps.ts`, add after the `fetchStep` function and before `saveStep`:

```ts
export interface StepSummary {
  name: string;
  protocol: string;
  method: string;
  url: string;
  grpcService: string;
  grpcMethod: string;
}

export interface StepSearchResult {
  items: StepSummary[];
  total: number;
}

export async function searchSteps(query: string, page: number, pageSize: number): Promise<StepSearchResult> {
  try {
    const params = new URLSearchParams({ search: query, page: String(page), pageSize: String(pageSize) });
    const response = await fetch(`/steps/search?${params.toString()}`);
    if (!response.ok) {
      return { items: [], total: 0 };
    }
    return (await response.json()) as StepSearchResult;
  } catch {
    return { items: [], total: 0 };
  }
}

export async function deleteStep(name: string): Promise<string[] | undefined> {
  try {
    const response = await fetch(`/steps/${encodeURIComponent(name)}`, { method: 'DELETE' });
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

In `packages/web/src/flows.ts`, add after the `fetchFlow` function and before `addStepToFlow`:

```ts
export interface FlowSummary {
  name: string;
  steps: string[];
}

export interface FlowSearchResult {
  items: FlowSummary[];
  total: number;
}

export async function searchFlows(query: string, page: number, pageSize: number): Promise<FlowSearchResult> {
  try {
    const params = new URLSearchParams({ search: query, page: String(page), pageSize: String(pageSize) });
    const response = await fetch(`/flows/search?${params.toString()}`);
    if (!response.ok) {
      return { items: [], total: 0 };
    }
    return (await response.json()) as FlowSearchResult;
  } catch {
    return { items: [], total: 0 };
  }
}

export async function deleteFlow(name: string): Promise<string[] | undefined> {
  try {
    const response = await fetch(`/flows/${encodeURIComponent(name)}`, { method: 'DELETE' });
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

Also update the import line in `steps.test.ts` to `import { fetchStepNames, fetchStep, saveStep, searchSteps, deleteStep } from '../src/steps';`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- steps.test.ts flows.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/steps.ts packages/web/src/flows.ts packages/web/test/steps.test.ts packages/web/test/flows.test.ts
git commit -m "feat(web): add searchSteps/deleteStep and searchFlows/deleteFlow client functions"
```

---

### Task 6: ManageStepsPage component — scaffold and Steps tab

**Files:**
- Create: `packages/web/src/components/ManageStepsPage.tsx`
- Modify: `packages/web/src/styles.css`
- Test: `packages/web/test/components/ManageStepsPage.test.tsx`

**Interfaces:**
- Consumes: `searchSteps`, `deleteStep` from `../steps` (Task 5); `fetchFlowNames`, `fetchFlow`, `deleteFlow` from `../flows` (Task 5 + pre-existing).
- Produces: `export interface ManageStepsPageProps { stepNames: string[]; onStepNamesChange: (names: string[]) => void; flowNames: string[]; onFlowNamesChange: (names: string[]) => void }`, `export function ManageStepsPage(props: ManageStepsPageProps)`. The Flows tab button exists and switches the active tab, but renders an empty `<div />` — Task 7 fills it in. This mirrors an established pattern in this project (the gRPC Runner increment had an analogous one-task gap between widening a component's props and wiring its consumer, documented in the commit history) — it's an intentional, temporary state between two tasks, not a gap left unresolved at the end of the plan.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/components/ManageStepsPage.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManageStepsPage } from '../../src/components/ManageStepsPage';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(handlers: Record<string, unknown>) {
  return vi.fn((url: string, init?: RequestInit) => {
    const key = init?.method ? `${init.method} ${url}` : url;
    const entry = handlers[key] ?? handlers[url];
    if (entry === undefined) {
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(entry) });
  });
}

function baseProps(overrides: Partial<Parameters<typeof ManageStepsPage>[0]> = {}) {
  return {
    stepNames: ['Create Payment'],
    onStepNamesChange: vi.fn(),
    flowNames: [],
    onFlowNamesChange: vi.fn(),
    ...overrides,
  };
}

describe('ManageStepsPage — Steps tab', () => {
  it('loads and renders page 1 of steps on mount', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/steps/search?search=&page=1&pageSize=20': {
          items: [
            { name: 'Create Payment', protocol: 'rest', method: 'POST', url: 'https://x.com', grpcService: '', grpcMethod: '' },
          ],
          total: 1,
        },
      })
    );

    render(<ManageStepsPage {...baseProps()} />);

    expect(await screen.findByText('Create Payment')).toBeInTheDocument();
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getByText('https://x.com')).toBeInTheDocument();
  });

  it('shows an empty state when there are no matches', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/steps/search?search=&page=1&pageSize=20': { items: [], total: 0 } }));
    render(<ManageStepsPage {...baseProps()} />);
    expect(await screen.findByText('No reusable steps found.')).toBeInTheDocument();
  });

  it('searches by the entered term when Search is clicked', async () => {
    const fetchMock = stubFetch({
      '/steps/search?search=&page=1&pageSize=20': { items: [], total: 0 },
      '/steps/search?search=payment&page=1&pageSize=20': {
        items: [{ name: 'Create Payment', protocol: 'rest', method: 'POST', url: 'https://x.com', grpcService: '', grpcMethod: '' }],
        total: 1,
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ManageStepsPage {...baseProps()} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    await userEvent.type(screen.getByLabelText('Reusable Step'), 'payment');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Create Payment')).toBeInTheDocument();
  });

  it('paginates with Prev/Next', async () => {
    const fetchMock = stubFetch({
      '/steps/search?search=&page=1&pageSize=20': { items: [{ name: 'Step A', protocol: 'rest', method: 'GET', url: '', grpcService: '', grpcMethod: '' }], total: 25 },
      '/steps/search?search=&page=2&pageSize=20': { items: [{ name: 'Step B', protocol: 'rest', method: 'GET', url: '', grpcService: '', grpcMethod: '' }], total: 25 },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ManageStepsPage {...baseProps()} />);
    expect(await screen.findByText('Step A')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Step B')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
  });

  it('deletes a step with a plain confirm when no flow references it, and updates stepNames', async () => {
    const onStepNamesChange = vi.fn();
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const fetchMock = stubFetch({
      '/steps/search?search=&page=1&pageSize=20': {
        items: [{ name: 'Create Payment', protocol: 'rest', method: 'POST', url: 'https://x.com', grpcService: '', grpcMethod: '' }],
        total: 1,
      },
      '/flows': [],
      'DELETE /steps/Create%20Payment': { names: [] },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ManageStepsPage {...baseProps({ onStepNamesChange })} />);
    await screen.findByText('Create Payment');

    await userEvent.click(screen.getByRole('button', { name: 'Delete Create Payment' }));

    expect(window.confirm).toHaveBeenCalledWith("Delete 'Create Payment'?");
    await waitFor(() => expect(onStepNamesChange).toHaveBeenCalledWith([]));
  });

  it('warns which flows reference the step before deleting', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const fetchMock = stubFetch({
      '/steps/search?search=&page=1&pageSize=20': {
        items: [{ name: 'Create Payment', protocol: 'rest', method: 'POST', url: 'https://x.com', grpcService: '', grpcMethod: '' }],
        total: 1,
      },
      '/flows': ['Checkout Flow'],
      '/flows/Checkout%20Flow': ['Login', 'Create Payment'],
      'DELETE /steps/Create%20Payment': { names: [] },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ManageStepsPage {...baseProps()} />);
    await screen.findByText('Create Payment');

    await userEvent.click(screen.getByRole('button', { name: 'Delete Create Payment' }));

    expect(window.confirm).toHaveBeenCalledWith("Used by flows: Checkout Flow. Delete anyway?");
  });

  it('steps back a page when deleting the last remaining row on a page beyond page 1', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const fetchMock = stubFetch({
      '/steps/search?search=&page=1&pageSize=20': {
        items: [{ name: 'Step A', protocol: 'rest', method: 'GET', url: '', grpcService: '', grpcMethod: '' }],
        total: 21,
      },
      '/steps/search?search=&page=2&pageSize=20': {
        items: [{ name: 'Step B', protocol: 'rest', method: 'GET', url: '', grpcService: '', grpcMethod: '' }],
        total: 21,
      },
      '/flows': [],
      'DELETE /steps/Step%20B': { names: ['Step A'] },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ManageStepsPage {...baseProps()} />);
    expect(await screen.findByText('Step A')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Step B')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Delete Step B' }));

    // Re-fetches page 1 (not page 2, which would now be empty) — proves the page-step-back logic, not just a stale re-render.
    expect(await screen.findByText('Step A')).toBeInTheDocument();
  });

  it('does not delete when the confirm dialog is dismissed', async () => {
    const onStepNamesChange = vi.fn();
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
    const fetchMock = stubFetch({
      '/steps/search?search=&page=1&pageSize=20': {
        items: [{ name: 'Create Payment', protocol: 'rest', method: 'POST', url: 'https://x.com', grpcService: '', grpcMethod: '' }],
        total: 1,
      },
      '/flows': [],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ManageStepsPage {...baseProps({ onStepNamesChange })} />);
    await screen.findByText('Create Payment');

    await userEvent.click(screen.getByRole('button', { name: 'Delete Create Payment' }));

    expect(onStepNamesChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ai-native-testing/web test -- ManageStepsPage.test.tsx`
Expected: FAIL — module `../../src/components/ManageStepsPage` does not exist.

- [ ] **Step 3: Implement the component**

Create `packages/web/src/components/ManageStepsPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { searchSteps, deleteStep, type StepSummary } from '../steps';
import { fetchFlowNames, fetchFlow } from '../flows';

export interface ManageStepsPageProps {
  stepNames: string[];
  onStepNamesChange: (names: string[]) => void;
  flowNames: string[];
  onFlowNamesChange: (names: string[]) => void;
}

const PAGE_SIZE = 20;

type Tab = 'steps' | 'flows';

export function ManageStepsPage({ onStepNamesChange }: ManageStepsPageProps) {
  const [tab, setTab] = useState<Tab>('steps');

  const [stepSearchInput, setStepSearchInput] = useState('');
  const [stepSearchTerm, setStepSearchTerm] = useState('');
  const [stepPage, setStepPage] = useState(1);
  const [stepItems, setStepItems] = useState<StepSummary[]>([]);
  const [stepTotal, setStepTotal] = useState(0);
  const [stepsError, setStepsError] = useState<string | null>(null);

  async function loadSteps(term: string, page: number) {
    const result = await searchSteps(term, page, PAGE_SIZE);
    setStepItems(result.items);
    setStepTotal(result.total);
  }

  useEffect(() => {
    loadSteps(stepSearchTerm, stepPage);
  }, [stepSearchTerm, stepPage]);

  function handleStepSearch() {
    setStepPage(1);
    setStepSearchTerm(stepSearchInput);
  }

  async function handleDeleteStep(name: string) {
    const allFlowNames = await fetchFlowNames();
    const referencingFlows: string[] = [];
    for (const flowName of allFlowNames) {
      const steps = await fetchFlow(flowName);
      if (steps?.includes(name)) {
        referencingFlows.push(flowName);
      }
    }

    const confirmed =
      referencingFlows.length > 0
        ? window.confirm(`Used by flows: ${referencingFlows.join(', ')}. Delete anyway?`)
        : window.confirm(`Delete '${name}'?`);
    if (!confirmed) {
      return;
    }

    const names = await deleteStep(name);
    if (names === undefined) {
      setStepsError(`Could not delete '${name}'. It may have already been removed.`);
      await loadSteps(stepSearchTerm, stepPage);
      return;
    }
    setStepsError(null);
    onStepNamesChange(names);

    const isLastRowOnPage = stepItems.length === 1 && stepPage > 1;
    if (isLastRowOnPage) {
      setStepPage(stepPage - 1);
    } else {
      await loadSteps(stepSearchTerm, stepPage);
    }
  }

  const stepTotalPages = Math.max(1, Math.ceil(stepTotal / PAGE_SIZE));

  return (
    <main className="app-main">
      <h1 className="heading-xl">Manage Load Reusable Step</h1>
      <div className="row">
        <button
          type="button"
          className={tab === 'steps' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setTab('steps')}
        >
          Steps
        </button>
        <button
          type="button"
          className={tab === 'flows' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setTab('flows')}
        >
          Flows
        </button>
      </div>

      {tab === 'steps' && (
        <section className="card">
          {stepsError && (
            <p role="alert" className="alert">
              {stepsError}
            </p>
          )}
          <label className="label">
            Reusable Step
            <input className="text-input" value={stepSearchInput} onChange={(e) => setStepSearchInput(e.target.value)} />
          </label>
          <button type="button" className="btn-secondary" onClick={handleStepSearch}>
            Search
          </button>

          {stepItems.length === 0 ? (
            <p className="field-hint">No reusable steps found.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Reusable Step</th>
                  <th>HTTP Verb</th>
                  <th>URL</th>
                  <th>Protocol</th>
                  <th>Service</th>
                  <th>Method</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {stepItems.map((item) => (
                  <tr key={item.name}>
                    <td>{item.name}</td>
                    <td>{item.protocol === 'rest' ? item.method : '—'}</td>
                    <td>{item.protocol === 'rest' ? item.url : '—'}</td>
                    <td>{item.protocol}</td>
                    <td>{item.protocol === 'grpc' ? item.grpcService : '—'}</td>
                    <td>{item.protocol === 'grpc' ? item.grpcMethod : '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="kv-remove"
                        aria-label={`Delete ${item.name}`}
                        onClick={() => handleDeleteStep(item.name)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="pagination">
            <button type="button" className="btn-secondary" disabled={stepPage <= 1} onClick={() => setStepPage(stepPage - 1)}>
              Prev
            </button>
            <span>
              Page {stepPage} of {stepTotalPages}
            </span>
            <button
              type="button"
              className="btn-secondary"
              disabled={stepPage >= stepTotalPages}
              onClick={() => setStepPage(stepPage + 1)}
            >
              Next
            </button>
          </div>
        </section>
      )}

      {tab === 'flows' && <div />}
    </main>
  );
}
```

Note: this task deliberately does not destructure `onFlowNamesChange` or import `deleteFlow`/`FlowSummary` — they're unused until Task 7 adds the Flows tab. This project's `tsconfig.base.json` does not set `noUnusedLocals`/`noUnusedParameters`, so leaving them out isn't required for `tsc --noEmit` to pass, but keeping the diff minimal to what this task actually uses makes the two tasks' diffs easier to review independently.

Add to `packages/web/src/styles.css`, after the existing `.field-hint` block:

```css
/* Manage Reusable Steps & Flows tables */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-body);
  font-size: 14px;
}

.data-table th,
.data-table td {
  text-align: left;
  padding: var(--space-sm) var(--space-md);
  border-bottom: 1px solid var(--color-hairline);
}

.pagination {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin-top: var(--space-md);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @ai-native-testing/web test -- ManageStepsPage.test.tsx`
Expected: PASS (all 8 Steps-tab tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors (see the note in Step 3 about possible unused-import fallout).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/ManageStepsPage.tsx packages/web/src/styles.css packages/web/test/components/ManageStepsPage.test.tsx
git commit -m "feat(web): add ManageStepsPage with a working Steps tab"
```

---

### Task 7: ManageStepsPage — Flows tab

**Files:**
- Modify: `packages/web/src/components/ManageStepsPage.tsx`
- Test: `packages/web/test/components/ManageStepsPage.test.tsx`

**Interfaces:**
- Consumes: `searchFlows`, `deleteFlow` from `../flows` (Task 5).

- [ ] **Step 1: Write the failing tests**

Append to `packages/web/test/components/ManageStepsPage.test.tsx`, as a new `describe` block:

```tsx
describe('ManageStepsPage — Flows tab', () => {
  it('loads and renders page 1 of flows when the Flows tab is opened', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/steps/search?search=&page=1&pageSize=20': { items: [], total: 0 },
        '/flows/search?search=&page=1&pageSize=20': {
          items: [{ name: 'Checkout Flow', steps: ['Login', 'Create Payment'] }],
          total: 1,
        },
      })
    );

    render(<ManageStepsPage {...baseProps()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Flows' }));

    expect(await screen.findByText('Checkout Flow')).toBeInTheDocument();
    expect(screen.getByText('Login, Create Payment')).toBeInTheDocument();
  });

  it('shows an empty state when there are no flow matches', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/steps/search?search=&page=1&pageSize=20': { items: [], total: 0 },
        '/flows/search?search=&page=1&pageSize=20': { items: [], total: 0 },
      })
    );

    render(<ManageStepsPage {...baseProps()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Flows' }));

    expect(await screen.findByText('No flows found.')).toBeInTheDocument();
  });

  it('searches flows by the entered term when Search is clicked', async () => {
    const fetchMock = stubFetch({
      '/steps/search?search=&page=1&pageSize=20': { items: [], total: 0 },
      '/flows/search?search=&page=1&pageSize=20': { items: [], total: 0 },
      '/flows/search?search=checkout&page=1&pageSize=20': {
        items: [{ name: 'Checkout Flow', steps: ['Login'] }],
        total: 1,
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ManageStepsPage {...baseProps()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Flows' }));
    await waitFor(() => expect(screen.getByText('No flows found.')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('E2E flow'), 'checkout');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Checkout Flow')).toBeInTheDocument();
  });

  it('deletes a flow with a plain confirm and updates flowNames', async () => {
    const onFlowNamesChange = vi.fn();
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const fetchMock = stubFetch({
      '/steps/search?search=&page=1&pageSize=20': { items: [], total: 0 },
      '/flows/search?search=&page=1&pageSize=20': {
        items: [{ name: 'Checkout Flow', steps: ['Login'] }],
        total: 1,
      },
      'DELETE /flows/Checkout%20Flow': { names: [] },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ManageStepsPage {...baseProps({ onFlowNamesChange })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Flows' }));
    await screen.findByText('Checkout Flow');

    await userEvent.click(screen.getByRole('button', { name: 'Delete Checkout Flow' }));

    expect(window.confirm).toHaveBeenCalledWith("Delete 'Checkout Flow'?");
    await waitFor(() => expect(onFlowNamesChange).toHaveBeenCalledWith([]));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- ManageStepsPage.test.tsx`
Expected: FAIL — the Flows tab currently renders an empty `<div />`, so none of the new queries find anything.

- [ ] **Step 3: Implement the Flows tab**

In `packages/web/src/components/ManageStepsPage.tsx`:

1. Update the import line to include `searchFlows`:
   ```ts
   import { fetchFlowNames, fetchFlow, deleteFlow, searchFlows, type FlowSummary } from '../flows';
   ```
2. Destructure `onFlowNamesChange` from props (change the function signature to `{ onStepNamesChange, onFlowNamesChange }: ManageStepsPageProps`).
3. Add Flows-tab state and handlers, alongside the existing Steps-tab state:
   ```ts
   const [flowSearchInput, setFlowSearchInput] = useState('');
   const [flowSearchTerm, setFlowSearchTerm] = useState('');
   const [flowPage, setFlowPage] = useState(1);
   const [flowItems, setFlowItems] = useState<FlowSummary[]>([]);
   const [flowTotal, setFlowTotal] = useState(0);
   const [flowsError, setFlowsError] = useState<string | null>(null);

   async function loadFlows(term: string, page: number) {
     const result = await searchFlows(term, page, PAGE_SIZE);
     setFlowItems(result.items);
     setFlowTotal(result.total);
   }

   useEffect(() => {
     loadFlows(flowSearchTerm, flowPage);
   }, [flowSearchTerm, flowPage]);

   function handleFlowSearch() {
     setFlowPage(1);
     setFlowSearchTerm(flowSearchInput);
   }

   async function handleDeleteFlow(name: string) {
     const confirmed = window.confirm(`Delete '${name}'?`);
     if (!confirmed) {
       return;
     }
     const names = await deleteFlow(name);
     if (names === undefined) {
       setFlowsError(`Could not delete '${name}'. It may have already been removed.`);
       await loadFlows(flowSearchTerm, flowPage);
       return;
     }
     setFlowsError(null);
     onFlowNamesChange(names);

     const isLastRowOnPage = flowItems.length === 1 && flowPage > 1;
     if (isLastRowOnPage) {
       setFlowPage(flowPage - 1);
     } else {
       await loadFlows(flowSearchTerm, flowPage);
     }
   }

   const flowTotalPages = Math.max(1, Math.ceil(flowTotal / PAGE_SIZE));
   ```
4. Replace `{tab === 'flows' && <div />}` with:
   ```tsx
   {tab === 'flows' && (
     <section className="card">
       {flowsError && (
         <p role="alert" className="alert">
           {flowsError}
         </p>
       )}
       <label className="label">
         E2E flow
         <input className="text-input" value={flowSearchInput} onChange={(e) => setFlowSearchInput(e.target.value)} />
       </label>
       <button type="button" className="btn-secondary" onClick={handleFlowSearch}>
         Search
       </button>

       {flowItems.length === 0 ? (
         <p className="field-hint">No flows found.</p>
       ) : (
         <table className="data-table">
           <thead>
             <tr>
               <th>Flow Name</th>
               <th>Steps</th>
               <th></th>
             </tr>
           </thead>
           <tbody>
             {flowItems.map((item) => (
               <tr key={item.name}>
                 <td>{item.name}</td>
                 <td>{item.steps.join(', ')}</td>
                 <td>
                   <button
                     type="button"
                     className="kv-remove"
                     aria-label={`Delete ${item.name}`}
                     onClick={() => handleDeleteFlow(item.name)}
                   >
                     ✕
                   </button>
                 </td>
               </tr>
             ))}
           </tbody>
         </table>
       )}

       <div className="pagination">
         <button type="button" className="btn-secondary" disabled={flowPage <= 1} onClick={() => setFlowPage(flowPage - 1)}>
           Prev
         </button>
         <span>
           Page {flowPage} of {flowTotalPages}
         </span>
         <button
           type="button"
           className="btn-secondary"
           disabled={flowPage >= flowTotalPages}
           onClick={() => setFlowPage(flowPage + 1)}
         >
           Next
         </button>
       </div>
     </section>
   )}
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- ManageStepsPage.test.tsx`
Expected: PASS (all Steps-tab and Flows-tab tests, 12 total).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/ManageStepsPage.tsx packages/web/test/components/ManageStepsPage.test.tsx
git commit -m "feat(web): implement the Flows tab in ManageStepsPage"
```

---

### Task 8: Sidebar entry, App.tsx wiring, and manual verification

**Files:**
- Modify: `packages/web/src/components/Sidebar.tsx`
- Modify: `packages/web/src/App.tsx`
- Test: `packages/web/test/components/Sidebar.test.tsx`
- Test: `packages/web/test/App.test.tsx`

**Interfaces:**
- Consumes: `ManageStepsPage` from Task 6/7, `stepNames`/`setStepNames`/`flowNames`/`setFlowNames` already present in `App.tsx`.

- [ ] **Step 1: Write the failing tests**

Update `packages/web/test/components/Sidebar.test.tsx` — every existing test's assertions about "the other links" need one more link added, and one new test for the new link. Replace the whole file:

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
  it('renders all five nav items with the correct hrefs', () => {
    renderSidebar('/');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Manage Load Reusable Step' })).toHaveAttribute('href', '/manage-steps');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).toHaveAttribute('href', '/e2e-test');
    expect(screen.getByRole('link', { name: 'API Automation' })).toHaveAttribute('href', '/api-automation');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).toHaveAttribute('href', '/kafka-checks');
  });

  it('marks Simple Mode active on the root path', () => {
    renderSidebar('/');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Manage Load Reusable Step' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'API Automation' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).not.toHaveAttribute('aria-current');
  });

  it('marks Manage Load Reusable Step active on /manage-steps, not the others', () => {
    renderSidebar('/manage-steps');
    expect(screen.getByRole('link', { name: 'Manage Load Reusable Step' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'API Automation' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).not.toHaveAttribute('aria-current');
  });

  it('marks End-to-end test active on /e2e-test, not the others', () => {
    renderSidebar('/e2e-test');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Manage Load Reusable Step' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'API Automation' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).not.toHaveAttribute('aria-current');
  });

  it('marks API Automation active on /api-automation, not the others', () => {
    renderSidebar('/api-automation');
    expect(screen.getByRole('link', { name: 'API Automation' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Manage Load Reusable Step' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).not.toHaveAttribute('aria-current');
  });

  it('marks Check Kafka active on /kafka-checks, not the others', () => {
    renderSidebar('/kafka-checks');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Manage Load Reusable Step' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'API Automation' })).not.toHaveAttribute('aria-current');
  });
});
```

In `packages/web/test/App.test.tsx`, replace the `stubNameListFetch` helper (used by default in `beforeEach` for nearly every test in this file) so it also handles the two new search endpoints:

```tsx
function stubNameListFetch(runsResponse: unknown = { ok: false, json: () => Promise.resolve({}) }) {
  return vi.fn((url: string) => {
    if (url.startsWith('/steps/search') || url.startsWith('/flows/search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], total: 0 }) });
    }
    if (url === '/actors' || url === '/tasks' || url === '/steps' || url === '/flows' || url === '/kafka-checks') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    return Promise.resolve(runsResponse);
  });
}
```

Then add, near the existing `it('switches to Check Kafka via the sidebar', ...)` test:

```tsx
it('switches to Manage Load Reusable Step via the sidebar', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('link', { name: 'Manage Load Reusable Step' }));
  expect(screen.getByRole('heading', { name: 'Manage Load Reusable Step' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- Sidebar.test.tsx App.test.tsx`
Expected: FAIL — no "Manage Load Reusable Step" link/route exists yet.

- [ ] **Step 3: Wire the Sidebar entry and route**

In `packages/web/src/components/Sidebar.tsx`, insert a new `NavLink` right after the "Simple Mode" one:

```tsx
<NavLink
  to="/manage-steps"
  className={({ isActive }) => (isActive ? 'sidebar-link sidebar-link--active' : 'sidebar-link')}
>
  Manage Load Reusable Step
</NavLink>
```

In `packages/web/src/App.tsx`:
1. Add the import: `import { ManageStepsPage } from './components/ManageStepsPage';`
2. Add a new `<Route>` inside `<Routes>`, positioned after the `/` route and before `/e2e-test` (matching the Sidebar's ordering):
   ```tsx
   <Route
     path="/manage-steps"
     element={
       <ManageStepsPage
         stepNames={stepNames}
         onStepNamesChange={setStepNames}
         flowNames={flowNames}
         onFlowNamesChange={setFlowNames}
       />
     }
   />
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- Sidebar.test.tsx App.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full workspace verification**

Run, from the repo root:
```bash
pnpm test
pnpm typecheck
```
Expected: all packages green, zero typecheck errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/Sidebar.tsx packages/web/src/App.tsx packages/web/test/components/Sidebar.test.tsx packages/web/test/App.test.tsx
git commit -m "feat(web): add Manage Load Reusable Step to the sidebar and routes"
```

- [ ] **Step 7: Manual verification**

Start the backend (`pnpm --filter @ai-native-testing/server start`) and web dev server (`pnpm --filter @ai-native-testing/web dev`). In a real browser:
1. Create two or three disposable test steps and one disposable test flow referencing one of them (via Simple Mode → Save as Reusable Step, and Add to E2E Flow) — use obviously-throwaway names, e.g. prefixed `zzz-manage-test-`. Do **not** touch any of the developer's real saved steps/flows.
2. Navigate to "Manage Load Reusable Step". Confirm it shows right after "Simple Mode" in the sidebar, and the table lists the disposable steps (plus whatever real ones exist) with correct Protocol/columns for both a REST and a gRPC step if you created one of each.
3. Search by a substring of one disposable step's name; confirm only matches show.
4. Click Delete on the step referenced by your disposable flow; confirm the "Used by flows: ..." warning appears, and that confirming deletes it — then check `packages/server/data/steps.json` no longer has that entry, and the disposable flow's step list still references the now-dangling name (matches the spec's documented, accepted risk — not something this feature fixes).
5. Click Delete on a step with no flow references; confirm the plain "Delete '...'?" dialog.
6. Switch to the Flows tab, search, and delete your disposable flow; confirm it's gone from `packages/server/data/flows.json`.
7. Go back to Simple Mode and confirm the deleted step no longer appears in "Load Reusable Step"'s dropdown without a page reload.
8. Clean up: confirm no disposable test data remains in `packages/server/data/steps.json` or `flows.json` (delete via the new UI itself, or manually if anything was left over), and confirm no real saved step/flow was touched.
