# API Runner (REST, Simple Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real `Runner` — `RestRunner`, in a new `packages/runner-api` package — that executes REST HTTP requests through the existing Screenplay Engine, plus the two small additive engine changes it needs (seeding config via `TestDefinition.variables`, and a new assertion-free `extract` step), proven end-to-end by registering it in the server and running the PRD's Login → Create Payment → Get Payment Status flow against a real local HTTP server.

**Architecture:** Two small, additive changes to `packages/engine` (`TestDefinition.variables` seeded into `RunContext` at run start; a new `extract` step type alongside `interaction`/`question`), then a new `packages/runner-api` package containing a minimal hand-rolled JSONPath-lite extractor, Bearer/API-key/Basic auth header helpers, and `RestRunner` itself (`interact('request', ...)` sends the HTTP call via Node's built-in `fetch` and stores the response in `RunContext`; `ask('status' | 'header' | 'jsonPath', ...)` reads back from it). `packages/server` registers `RestRunner` alongside the existing `LogRunner`.

**Tech Stack:** TypeScript (strict, ESM, NodeNext), pnpm workspaces, Vitest, Node's built-in `fetch`/`AbortController`/`node:http` (test servers only) — no new runtime dependencies.

Spec: [`docs/superpowers/specs/2026-07-27-api-runner-design.md`](../specs/2026-07-27-api-runner-design.md)

## Global Constraints

- Node.js >= 20 (built-in `fetch`, `AbortController`, `crypto.randomUUID`, `server.closeAllConnections`).
- Package manager: pnpm, workspace layout under `packages/*` (already configured — no changes needed to `pnpm-workspace.yaml`).
- TypeScript strict mode, ESM (`"type": "module"`), `module`/`moduleResolution: "NodeNext"` — all relative imports must use explicit `.js` extensions (even though the files are `.ts`).
- Test framework: Vitest (`vitest run`), test files under each package's `test/` directory.
- No new runtime dependency for HTTP — use Node's built-in `fetch`. No JSONPath library — a minimal hand-rolled dot + bracket-index subset only (not the full JSONPath spec).
- REST only in this sub-project — no gRPC, no GraphQL.
- Simple Mode execution semantics only — no Conditions, Loops, Parallel branches, Retry policies, Polling, Hooks, Data-driven testing, Test Suites, Code generation, headless/CI-CD execution, or reuse of Tasks across separate test definitions.
- No changes to `Actor.abilities` — it stays `string[]`, purely a label, not enforced against the `runner` field steps use.
- `request` interaction never throws on a non-2xx HTTP status — only on transport-level failure (DNS, connection refused, timeout). Negative/boundary tests assert on `status` instead.
- `extract` never compares or fails on its own — it only fails (fail-fast) if the Runner's `ask` call itself throws.
- In-memory persistence only, no auth on the platform's own management API (unchanged from Core).
- Explicitly out of scope — do not implement: gRPC, GraphQL, Advanced Mode execution semantics (reuse across test definitions, Conditions, Loops, Parallel, Retry, Polling, Hooks, Data-driven, Test Suites), code generation, headless/CI-CD execution, import (OpenAPI/cURL/Postman), OAuth2 flow, mTLS, the visual builder UI, persistent database.

---

### Task 1: Engine — seed `TestDefinition.variables` into `RunContext`

**Files:**
- Modify: `packages/engine/src/types.ts`
- Modify: `packages/engine/src/schema.ts`
- Modify: `packages/engine/src/dispatcher.ts`
- Test: `packages/engine/test/dispatcher.test.ts`
- Test: `packages/engine/test/schema.test.ts`

**Interfaces:**
- Consumes: existing `RunContext.remember(name: string, value: unknown): void`.
- Produces: `TestDefinition.variables?: Record<string, unknown>` — seeded into the run's `RunContext` via `remember` before the first step executes. Later tasks (and REST test definitions) rely on this to supply `baseUrl`, credentials, etc. before any step runs.

- [ ] **Step 1: Write a failing dispatcher test for variable seeding**

In `packages/engine/test/dispatcher.test.ts`, add the following test inside the `describe('runDefinition', () => { ... })` block, right before its closing `});`:

```ts
  it('seeds RunContext from definition.variables before the first step runs', async () => {
    const askMock = vi.fn().mockResolvedValue('ok');
    const runner: Runner = {
      name: 'log',
      interact: vi.fn().mockResolvedValue(undefined),
      ask: askMock,
    };
    const registry = new RunnerRegistry();
    registry.register(runner);

    const definition: TestDefinition = {
      actor: { name: 'Customer', abilities: ['log'] },
      variables: { baseUrl: 'https://api.example.com' },
      tasks: [
        {
          name: 'T',
          steps: [
            { type: 'question', runner: 'log', action: 'echo', with: { value: '${baseUrl}' }, expect: { equals: 'ok' } },
          ],
        },
      ],
    };

    const { done } = runDefinition(definition, registry);
    const result = await done;

    expect(result).toEqual({ status: 'passed' });
    expect(askMock).toHaveBeenCalledWith('echo', { value: 'https://api.example.com' }, expect.anything());
  });
```

Note the `expect.equals: 'ok'` in the test data matches the mocked `ask` return value regardless of seeding, so `result` being `'passed'` isn't what proves seeding works — the `toHaveBeenCalledWith` assertion is: it pins down that `${baseUrl}` actually resolved to the real URL, not `undefined`.

**Step 2: Write a failing schema test for the `variables` field**

In `packages/engine/test/schema.test.ts`, add the following test inside the `describe('validateTestDefinition', () => { ... })` block, right before its closing `});`:

```ts
  it('accepts a definition with a variables field', () => {
    const withVariables = {
      ...validDefinition,
      variables: { baseUrl: 'https://api.example.com' },
    };
    expect(validateTestDefinition(withVariables)).toEqual({ valid: true });
  });
```

- [ ] **Step 3: Run both test files to verify they fail**

Run: `pnpm --filter @ai-native-testing/engine test`
Expected: the two new tests FAIL — the dispatcher test's `toHaveBeenCalledWith` assertion fails because `${baseUrl}` resolves to `undefined` (nothing has seeded it), and the schema test fails because `testDefinitionSchema` has `additionalProperties: false` and doesn't yet know about `variables`, so `validateTestDefinition` returns `{ valid: false, errors: [...] }`.

- [ ] **Step 4: Add `variables` to the `TestDefinition` type**

In `packages/engine/src/types.ts`, change:

```ts
export interface TestDefinition {
  actor: Actor;
  tasks: TaskDefinition[];
}
```

to:

```ts
export interface TestDefinition {
  actor: Actor;
  tasks: TaskDefinition[];
  variables?: Record<string, unknown>;
}
```

- [ ] **Step 5: Add `variables` to the JSON Schema**

In `packages/engine/src/schema.ts`, in `testDefinitionSchema`, change:

```ts
  properties: {
    actor: {
      type: 'object',
      required: ['name', 'abilities'],
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        abilities: { type: 'array', items: { type: 'string' } },
      },
    },
    tasks: {
      type: 'array',
      minItems: 1,
      items: { $ref: 'taskDefinition' },
    },
  },
```

to:

```ts
  properties: {
    actor: {
      type: 'object',
      required: ['name', 'abilities'],
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        abilities: { type: 'array', items: { type: 'string' } },
      },
    },
    tasks: {
      type: 'array',
      minItems: 1,
      items: { $ref: 'taskDefinition' },
    },
    variables: { type: 'object' },
  },
```

- [ ] **Step 6: Seed `RunContext` from `definition.variables` in `runDefinition`**

In `packages/engine/src/dispatcher.ts`, change:

```ts
export function runDefinition(definition: TestDefinition, registry: RunnerRegistry): RunHandle {
  const emitter = new EventEmitter();
  const ctx = new RunContext();
  const steps = definition.tasks.flatMap((task) => flattenSteps(task.steps));
```

to:

```ts
export function runDefinition(definition: TestDefinition, registry: RunnerRegistry): RunHandle {
  const emitter = new EventEmitter();
  const ctx = new RunContext();
  if (definition.variables) {
    for (const [name, value] of Object.entries(definition.variables)) {
      ctx.remember(name, value);
    }
  }
  const steps = definition.tasks.flatMap((task) => flattenSteps(task.steps));
```

- [ ] **Step 7: Run the tests again to verify they pass**

Run: `pnpm --filter @ai-native-testing/engine test`
Expected: PASS (all tests, including the two new ones).

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/engine typecheck`
Expected: no errors.

```bash
git add packages/engine/src/types.ts packages/engine/src/schema.ts packages/engine/src/dispatcher.ts packages/engine/test/dispatcher.test.ts packages/engine/test/schema.test.ts
git commit -m "feat(engine): seed RunContext from TestDefinition.variables"
```

---

### Task 2: Engine — add the `extract` step type

**Files:**
- Modify: `packages/engine/src/types.ts`
- Modify: `packages/engine/src/schema.ts`
- Modify: `packages/engine/src/dispatcher.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/dispatcher.test.ts`
- Test: `packages/engine/test/schema.test.ts`

**Interfaces:**
- Consumes: existing `Runner.ask(action, args, ctx): Promise<unknown>`, `RunContext.remember`.
- Produces: `ExtractStep` (`{ type: 'extract', runner, action, with?, remember }`), added to the `Step` union and `LeafStep`. Dispatcher behavior: call `runner.ask(...)`, unconditionally `ctx.remember(step.remember, actual)`, emit `step:completed` — no pass/fail comparison. Fails (fail-fast) only if `ask` throws. `StepResult['type']` now includes `'extract'`.

- [ ] **Step 1: Write failing dispatcher tests for the `extract` step**

In `packages/engine/test/dispatcher.test.ts`, add the following two tests inside the `describe('runDefinition', () => { ... })` block, right before its closing `});`:

```ts
  it('runs an extract step: unconditionally remembers the answer, no pass/fail comparison', async () => {
    const askMock = vi.fn(async (_action: string, args: Record<string, unknown>) => args.value);
    const runner: Runner = {
      name: 'log',
      interact: vi.fn().mockResolvedValue(undefined),
      ask: askMock,
    };
    const registry = new RunnerRegistry();
    registry.register(runner);

    const definition: TestDefinition = {
      actor: { name: 'Customer', abilities: ['log'] },
      tasks: [
        {
          name: 'T',
          steps: [
            { type: 'extract', runner: 'log', action: 'echo', with: { value: 'remembered-value' }, remember: 'x' },
            { type: 'question', runner: 'log', action: 'echo', with: { value: '${x}' }, expect: { equals: 'remembered-value' } },
          ],
        },
      ],
    };

    const { emitter, done } = runDefinition(definition, registry);
    const events = collectEvents(emitter);
    const result = await done;

    expect(result).toEqual({ status: 'passed' });
    const extractEvent = events.find((e) => e.type === 'step:completed' && e.result.type === 'extract');
    expect(extractEvent).toBeDefined();
  });

  it("fails the run when an extract step's ask throws", async () => {
    const runner: Runner = {
      name: 'log',
      interact: vi.fn().mockResolvedValue(undefined),
      ask: vi.fn().mockRejectedValue(new Error('bad path')),
    };
    const registry = new RunnerRegistry();
    registry.register(runner);

    const definition: TestDefinition = {
      actor: { name: 'Customer', abilities: ['log'] },
      tasks: [{ name: 'T', steps: [{ type: 'extract', runner: 'log', action: 'echo', with: {}, remember: 'x' }] }],
    };

    const { done } = runDefinition(definition, registry);
    const result = await done;
    expect(result).toEqual({ status: 'failed' });
  });
```

The first test proves `remember` actually ran: if it didn't, `${x}` in the second step would resolve to `undefined`, `askMock` would return `undefined` (since it echoes back whatever `args.value` it was given), and the second step's `expect.equals: 'remembered-value'` would fail.

- [ ] **Step 2: Write failing schema tests for the `extract` step**

In `packages/engine/test/schema.test.ts`, add the following two tests inside the `describe('validateTestDefinition', () => { ... })` block, right before its closing `});`:

```ts
  it('accepts an extract step', () => {
    const withExtract = {
      actor: validDefinition.actor,
      tasks: [
        {
          name: 'T',
          steps: [{ type: 'extract', runner: 'log', action: 'echo', with: { value: 1 }, remember: 'x' }],
        },
      ],
    };
    expect(validateTestDefinition(withExtract)).toEqual({ valid: true });
  });

  it('rejects an extract step missing the remember field', () => {
    const invalid = {
      actor: validDefinition.actor,
      tasks: [{ name: 'T', steps: [{ type: 'extract', runner: 'log', action: 'echo', with: {} }] }],
    };
    expect(validateTestDefinition(invalid).valid).toBe(false);
  });
```

- [ ] **Step 3: Run all engine tests to verify the four new tests fail**

Run: `pnpm --filter @ai-native-testing/engine test`
Expected: the two dispatcher tests FAIL (the `extract` type isn't recognized, so the dispatcher's `else` branch currently treats it as a `question` and crashes trying to read `step.expect.equals`, which is `undefined`), and the two schema tests FAIL (`extract` isn't a valid `type` in the step `oneOf`, so both the accept and reject cases behave incorrectly — the "accepts" case actually gets rejected).

- [ ] **Step 4: Add `ExtractStep` to `types.ts`**

In `packages/engine/src/types.ts`, change:

```ts
export interface TaskStep {
  type: 'task';
  name: string;
  steps: Step[];
}

export type Step = InteractionStep | QuestionStep | TaskStep;
export type LeafStep = InteractionStep | QuestionStep;
```

to:

```ts
export interface TaskStep {
  type: 'task';
  name: string;
  steps: Step[];
}

export interface ExtractStep {
  type: 'extract';
  runner: string;
  action: string;
  with?: Record<string, unknown>;
  remember: string;
}

export type Step = InteractionStep | QuestionStep | TaskStep | ExtractStep;
export type LeafStep = InteractionStep | QuestionStep | ExtractStep;
```

And change:

```ts
export interface StepResult {
  type: 'interaction' | 'question';
```

to:

```ts
export interface StepResult {
  type: 'interaction' | 'question' | 'extract';
```

- [ ] **Step 5: Add the `extract` variant to the step schema**

In `packages/engine/src/schema.ts`, in `stepSchema`'s `oneOf` array, add a new entry after the `question` variant and before the `task` variant:

```ts
    {
      type: 'object',
      required: ['type', 'runner', 'action', 'remember'],
      additionalProperties: false,
      properties: {
        type: { const: 'extract' },
        runner: { type: 'string' },
        action: { type: 'string' },
        with: { type: 'object' },
        remember: { type: 'string' },
      },
    },
```

- [ ] **Step 6: Add the `extract` branch to the dispatcher**

In `packages/engine/src/dispatcher.ts`, change:

```ts
      if (step.type === 'interaction') {
        await runner.interact(step.action, args, ctx);
        const result: StepResult = {
          type: 'interaction',
          runner: step.runner,
          action: step.action,
          status: 'passed',
          args,
        };
        emitter.emit('event', { type: 'step:completed', index, result } satisfies RunEvent);
      } else {
        const actual = await runner.ask(step.action, args, ctx);
        const expected = ctx.resolve(step.expect.equals);
```

to:

```ts
      if (step.type === 'interaction') {
        await runner.interact(step.action, args, ctx);
        const result: StepResult = {
          type: 'interaction',
          runner: step.runner,
          action: step.action,
          status: 'passed',
          args,
        };
        emitter.emit('event', { type: 'step:completed', index, result } satisfies RunEvent);
      } else if (step.type === 'extract') {
        const actual = await runner.ask(step.action, args, ctx);
        ctx.remember(step.remember, actual);
        const result: StepResult = {
          type: 'extract',
          runner: step.runner,
          action: step.action,
          status: 'passed',
          args,
          actual,
        };
        emitter.emit('event', { type: 'step:completed', index, result } satisfies RunEvent);
      } else {
        const actual = await runner.ask(step.action, args, ctx);
        const expected = ctx.resolve(step.expect.equals);
```

- [ ] **Step 7: Export `ExtractStep` from the package**

In `packages/engine/src/index.ts`, change:

```ts
export type {
  Actor,
  InteractionStep,
  QuestionStep,
  TaskStep,
  Step,
  LeafStep,
  TaskDefinition,
  TestDefinition,
  StepResult,
  RunEvent,
} from './types.js';
```

to:

```ts
export type {
  Actor,
  InteractionStep,
  QuestionStep,
  TaskStep,
  ExtractStep,
  Step,
  LeafStep,
  TaskDefinition,
  TestDefinition,
  StepResult,
  RunEvent,
} from './types.js';
```

- [ ] **Step 8: Run all engine tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/engine test`
Expected: PASS (all tests, including the four new ones).

- [ ] **Step 9: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/engine typecheck`
Expected: no errors.

```bash
git add packages/engine/src/types.ts packages/engine/src/schema.ts packages/engine/src/dispatcher.ts packages/engine/src/index.ts packages/engine/test/dispatcher.test.ts packages/engine/test/schema.test.ts
git commit -m "feat(engine): add extract step type"
```

---

### Task 3: `runner-api` package scaffold + JSONPath-lite extractor

**Files:**
- Create: `packages/runner-api/package.json`
- Create: `packages/runner-api/tsconfig.json`
- Create: `packages/runner-api/src/json-path.ts`
- Test: `packages/runner-api/test/json-path.test.ts`

**Interfaces:**
- Produces: `extractJsonPath(value: unknown, path: string): unknown` — supports dot notation (`$.data.paymentId`) and bracket numeric indices (`$.data.items[0].id`). Throws if `path` doesn't start with `$`, if an intermediate segment is `null`/`undefined`, or if the final resolved value is `undefined`. Used internally by `RestRunner` (Task 5); not otherwise consumed yet.

- [ ] **Step 1: Create the package manifest**

Create `packages/runner-api/package.json`:

```json
{
  "name": "@ai-native-testing/runner-api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ai-native-testing/engine": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^26.1.1",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2: Create the TypeScript config**

Create `packages/runner-api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Install workspace dependencies**

Run: `pnpm install`
Expected: `packages/runner-api` is linked into the workspace (no errors). This will fail to find any source files yet — that's expected until later steps.

- [ ] **Step 4: Write failing tests for `extractJsonPath`**

Create `packages/runner-api/test/json-path.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractJsonPath } from '../src/json-path.js';

describe('extractJsonPath', () => {
  it('extracts a nested string field', () => {
    const body = { data: { paymentId: 'pay_123' } };
    expect(extractJsonPath(body, '$.data.paymentId')).toBe('pay_123');
  });

  it('extracts a value from an array index', () => {
    const body = { data: { items: [{ id: 'a' }, { id: 'b' }] } };
    expect(extractJsonPath(body, '$.data.items[1].id')).toBe('b');
  });

  it('throws when the path does not start with $', () => {
    expect(() => extractJsonPath({}, 'data.id')).toThrow('must start with "$"');
  });

  it('throws when an intermediate segment is missing', () => {
    const body = { data: {} };
    expect(() => extractJsonPath(body, '$.data.missing.deeper')).toThrow(/could not be resolved/);
  });

  it('throws when the final value is undefined', () => {
    const body = { data: {} };
    expect(() => extractJsonPath(body, '$.data.missing')).toThrow(/did not resolve to a value/);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @ai-native-testing/runner-api test`
Expected: FAIL — `../src/json-path.js` does not exist.

- [ ] **Step 6: Implement `extractJsonPath`**

Create `packages/runner-api/src/json-path.ts`:

```ts
export function extractJsonPath(value: unknown, path: string): unknown {
  const segments = parsePath(path);
  let current: unknown = value;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      throw new Error(`JSONPath "${path}" could not be resolved: reached ${String(current)} at "${segment}"`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (current === undefined) {
    throw new Error(`JSONPath "${path}" did not resolve to a value`);
  }
  return current;
}

function parsePath(path: string): string[] {
  if (!path.startsWith('$')) {
    throw new Error(`JSONPath "${path}" must start with "$"`);
  }
  const rest = path.slice(1);
  const segments: string[] = [];
  const regex = /\.([^.[\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  while ((match = regex.exec(rest)) !== null) {
    if (match.index !== lastIndex) {
      throw new Error(`JSONPath "${path}" is malformed near "${rest.slice(lastIndex)}"`);
    }
    segments.push((match[1] ?? match[2]) as string);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex !== rest.length) {
    throw new Error(`JSONPath "${path}" is malformed near "${rest.slice(lastIndex)}"`);
  }
  return segments;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @ai-native-testing/runner-api test`
Expected: PASS (all 5 tests).

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/runner-api typecheck`
Expected: no errors.

```bash
git add packages/runner-api/package.json packages/runner-api/tsconfig.json packages/runner-api/src/json-path.ts packages/runner-api/test/json-path.test.ts pnpm-lock.yaml
git commit -m "feat(runner-api): add minimal JSONPath-lite extractor"
```

---

### Task 4: Auth header helpers

**Files:**
- Create: `packages/runner-api/src/auth.ts`
- Test: `packages/runner-api/test/auth.test.ts`

**Interfaces:**
- Produces: `AuthConfig` (discriminated union: `{ type: 'bearer', token }` | `{ type: 'apiKey', header, value }` | `{ type: 'basic', username, password }`) and `buildAuthHeaders(auth: AuthConfig): Record<string, string>`. Consumed by `RestRunner` (Task 5).

- [ ] **Step 1: Write failing tests for `buildAuthHeaders`**

Create `packages/runner-api/test/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildAuthHeaders } from '../src/auth.js';

describe('buildAuthHeaders', () => {
  it('builds a Bearer authorization header', () => {
    expect(buildAuthHeaders({ type: 'bearer', token: 'abc123' })).toEqual({
      Authorization: 'Bearer abc123',
    });
  });

  it('builds an API key header using the given header name', () => {
    expect(buildAuthHeaders({ type: 'apiKey', header: 'X-API-Key', value: 'secret' })).toEqual({
      'X-API-Key': 'secret',
    });
  });

  it('builds a Basic authorization header from username and password', () => {
    const headers = buildAuthHeaders({ type: 'basic', username: 'alice', password: 'hunter2' });
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('alice:hunter2').toString('base64')}`);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ai-native-testing/runner-api test`
Expected: FAIL — `../src/auth.js` does not exist.

- [ ] **Step 3: Implement `buildAuthHeaders`**

Create `packages/runner-api/src/auth.ts`:

```ts
export type AuthConfig =
  | { type: 'bearer'; token: string }
  | { type: 'apiKey'; header: string; value: string }
  | { type: 'basic'; username: string; password: string };

export function buildAuthHeaders(auth: AuthConfig): Record<string, string> {
  switch (auth.type) {
    case 'bearer':
      return { Authorization: `Bearer ${auth.token}` };
    case 'apiKey':
      return { [auth.header]: auth.value };
    case 'basic': {
      const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      return { Authorization: `Basic ${encoded}` };
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @ai-native-testing/runner-api test`
Expected: PASS (all tests, including the 3 new ones and the 5 from Task 3).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/runner-api typecheck`
Expected: no errors.

```bash
git add packages/runner-api/src/auth.ts packages/runner-api/test/auth.test.ts
git commit -m "feat(runner-api): add auth header helpers"
```

---

### Task 5: `RestRunner` — request interaction + status/header/jsonPath ask actions

**Files:**
- Create: `packages/runner-api/test/test-server.ts`
- Create: `packages/runner-api/src/rest-runner.ts`
- Create: `packages/runner-api/src/index.ts`
- Test: `packages/runner-api/test/rest-runner.test.ts`

**Interfaces:**
- Consumes: `Runner` interface and `RunContext` from `@ai-native-testing/engine`; `buildAuthHeaders`/`AuthConfig` from `./auth.js` (Task 4); `extractJsonPath` from `./json-path.js` (Task 3).
- Produces: `RestRunner implements Runner`, `name = 'rest'`. `interact('request', { method, url, headers?, query?, body?, auth? }, ctx)` sends the HTTP request via `fetch` (default 30s timeout, overridable via constructor `{ timeoutMs }`), stores `{ status, headers, body }` in `ctx` under the reserved key `__rest.lastResponse`. `ask('status' | 'header' | 'jsonPath', args, ctx)` reads back from that stored response. Exported from the package's `src/index.ts` alongside `AuthConfig`/`buildAuthHeaders`/`extractJsonPath`. Consumed by `packages/server` (Task 6).

- [ ] **Step 1: Create a shared local HTTP test server helper**

Create `packages/runner-api/test/test-server.ts`:

```ts
import http, { type IncomingMessage, type ServerResponse } from 'node:http';

export type TestServerHandler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

export interface TestServer {
  url: string;
  close: () => Promise<void>;
}

export async function startTestServer(handler: TestServerHandler): Promise<TestServer> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      handler(req, res, Buffer.concat(chunks).toString('utf8'));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('failed to determine test server address');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
```

- [ ] **Step 2: Write failing tests for `RestRunner`**

Create `packages/runner-api/test/rest-runner.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { RunContext } from '@ai-native-testing/engine';
import { RestRunner } from '../src/rest-runner.js';
import { startTestServer, type TestServer } from './test-server.js';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('RestRunner', () => {
  it('sends a GET request and stores the response for later ask calls', async () => {
    server = await startTestServer((req, res) => {
      expect(req.method).toBe('GET');
      expect(req.url).toBe('/v1/payments/pay_123');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { status: 'SUCCESS' } }));
    });

    const runner = new RestRunner();
    const ctx = new RunContext();
    await runner.interact('request', { method: 'GET', url: `${server.url}/v1/payments/pay_123` }, ctx);

    expect(await runner.ask('status', {}, ctx)).toBe(200);
    expect(await runner.ask('jsonPath', { path: '$.data.status' }, ctx)).toBe('SUCCESS');
  });

  it('sends a JSON body on POST and sets Content-Type automatically', async () => {
    let receivedBody = '';
    let receivedContentType: string | undefined;
    server = await startTestServer((req, res, body) => {
      receivedBody = body;
      receivedContentType = req.headers['content-type'];
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { paymentId: 'pay_123' } }));
    });

    const runner = new RestRunner();
    const ctx = new RunContext();
    await runner.interact(
      'request',
      { method: 'POST', url: server.url, body: { orderId: 'order-1', amount: 10 } },
      ctx
    );

    expect(JSON.parse(receivedBody)).toEqual({ orderId: 'order-1', amount: 10 });
    expect(receivedContentType).toBe('application/json');
  });

  it('applies a bearer auth header', async () => {
    let receivedAuth: string | undefined;
    server = await startTestServer((req, res) => {
      receivedAuth = req.headers.authorization;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });

    const runner = new RestRunner();
    const ctx = new RunContext();
    await runner.interact(
      'request',
      { method: 'GET', url: server.url, auth: { type: 'bearer', token: 'tok-1' } },
      ctx
    );

    expect(receivedAuth).toBe('Bearer tok-1');
  });

  it('appends query parameters to the URL', async () => {
    let receivedUrl = '';
    server = await startTestServer((req, res) => {
      receivedUrl = req.url ?? '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });

    const runner = new RestRunner();
    const ctx = new RunContext();
    await runner.interact('request', { method: 'GET', url: server.url, query: { page: '2' } }, ctx);

    expect(receivedUrl).toBe('/?page=2');
  });

  it('reads a response header value', async () => {
    server = await startTestServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Request-Id': 'req-42' });
      res.end('{}');
    });

    const runner = new RestRunner();
    const ctx = new RunContext();
    await runner.interact('request', { method: 'GET', url: server.url }, ctx);

    expect(await runner.ask('header', { name: 'X-Request-Id' }, ctx)).toBe('req-42');
  });

  it('throws when extracting via jsonPath from a non-JSON response body', async () => {
    server = await startTestServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('hello world');
    });

    const runner = new RestRunner();
    const ctx = new RunContext();
    await runner.interact('request', { method: 'GET', url: server.url }, ctx);

    await expect(runner.ask('jsonPath', { path: '$.foo' }, ctx)).rejects.toThrow(/did not resolve to a value/);
  });

  it('does not throw on a non-2xx HTTP status, so negative tests can assert it', async () => {
    server = await startTestServer((req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });

    const runner = new RestRunner();
    const ctx = new RunContext();
    await runner.interact('request', { method: 'GET', url: server.url }, ctx);

    expect(await runner.ask('status', {}, ctx)).toBe(404);
  });

  it('rejects an unknown interaction action', async () => {
    const runner = new RestRunner();
    const ctx = new RunContext();
    await expect(runner.interact('unknown', {}, ctx)).rejects.toThrow(
      'RestRunner does not support interaction "unknown"'
    );
  });

  it('rejects an unknown question action', async () => {
    server = await startTestServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });

    const runner = new RestRunner();
    const ctx = new RunContext();
    await runner.interact('request', { method: 'GET', url: server.url }, ctx);

    await expect(runner.ask('unknown', {}, ctx)).rejects.toThrow(
      'RestRunner does not support question "unknown"'
    );
  });

  it('throws when asked before any request has been made', async () => {
    const runner = new RestRunner();
    const ctx = new RunContext();
    await expect(runner.ask('status', {}, ctx)).rejects.toThrow(
      'RestRunner "status" called before any "request" interaction'
    );
  });

  it('throws when the server is unreachable', async () => {
    const runner = new RestRunner();
    const ctx = new RunContext();
    await expect(runner.interact('request', { method: 'GET', url: 'http://127.0.0.1:1' }, ctx)).rejects.toThrow();
  });

  it('throws when the request exceeds the configured timeout', async () => {
    server = await startTestServer(() => {
      // Never responds — this test uses a short timeoutMs instead of waiting
      // out the real 30s default, so it stays fast.
    });

    const runner = new RestRunner({ timeoutMs: 50 });
    const ctx = new RunContext();
    await expect(runner.interact('request', { method: 'GET', url: server.url }, ctx)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/runner-api test`
Expected: FAIL — `../src/rest-runner.js` does not exist.

- [ ] **Step 4: Implement `RestRunner`**

Create `packages/runner-api/src/rest-runner.ts`:

```ts
import type { Runner, RunContext } from '@ai-native-testing/engine';
import { buildAuthHeaders, type AuthConfig } from './auth.js';
import { extractJsonPath } from './json-path.js';

interface RestResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

interface RequestArgs {
  method: string;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  auth?: AuthConfig;
}

const LAST_RESPONSE_KEY = '__rest.lastResponse';
const DEFAULT_TIMEOUT_MS = 30_000;

export interface RestRunnerOptions {
  timeoutMs?: number;
}

export class RestRunner implements Runner {
  name = 'rest';
  private readonly timeoutMs: number;

  constructor(options?: RestRunnerOptions) {
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async interact(action: string, args: Record<string, unknown>, ctx: RunContext): Promise<void> {
    if (action !== 'request') {
      throw new Error(`RestRunner does not support interaction "${action}"`);
    }
    const response = await this.sendRequest(args as unknown as RequestArgs);
    ctx.remember(LAST_RESPONSE_KEY, response);
  }

  async ask(action: string, args: Record<string, unknown>, ctx: RunContext): Promise<unknown> {
    const response = ctx.get(LAST_RESPONSE_KEY) as RestResponse | undefined;
    if (!response) {
      throw new Error(`RestRunner "${action}" called before any "request" interaction`);
    }
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
  }

  private async sendRequest(args: RequestArgs): Promise<RestResponse> {
    const url = new URL(args.url);
    if (args.query) {
      for (const [key, value] of Object.entries(args.query)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = { ...args.headers };
    if (args.auth) {
      Object.assign(headers, buildAuthHeaders(args.auth));
    }

    const hasBody = args.body !== undefined;
    if (hasBody && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: args.method,
        headers,
        body: hasBody ? JSON.stringify(args.body) : undefined,
        signal: controller.signal,
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });

      const text = await response.text();
      let body: unknown = text;
      if (responseHeaders['content-type']?.includes('application/json') && text.length > 0) {
        body = JSON.parse(text);
      }

      return { status: response.status, headers: responseHeaders, body };
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

- [ ] **Step 5: Create the package's public barrel export**

Create `packages/runner-api/src/index.ts`:

```ts
export { RestRunner, type RestRunnerOptions } from './rest-runner.js';
export { buildAuthHeaders, type AuthConfig } from './auth.js';
export { extractJsonPath } from './json-path.js';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/runner-api test`
Expected: PASS (all tests, including the 12 new `RestRunner` tests).

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/runner-api typecheck`
Expected: no errors.

```bash
git add packages/runner-api/test/test-server.ts packages/runner-api/src/rest-runner.ts packages/runner-api/src/index.ts packages/runner-api/test/rest-runner.test.ts
git commit -m "feat(runner-api): add RestRunner executing real HTTP requests"
```

---

### Task 6: Register `RestRunner` in the server + end-to-end REST flow test

**Files:**
- Modify: `packages/server/package.json`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/test/rest-flow.test.ts`

**Interfaces:**
- Consumes: `RestRunner` from `@ai-native-testing/runner-api` (Task 5); `buildApp()` from `../src/app.js`; existing `POST /runs`, `GET /runs/:jobId` routes (unchanged).
- Produces: nothing new for later tasks — this is the final integration point for this sub-project.

> **Note (discovered while implementing this task):** running the end-to-end
> test after registering `RestRunner` still failed — every request threw
> `Invalid URL`. Root cause: `RunContext.resolve` (`packages/engine/src/context.ts`)
> only resolved a value when it was *exactly* `${var}`; embedding a variable
> inside a larger string like `${baseUrl}/login` passed through unresolved.
> This is a bug in Core, not in this task's own files — fixed as a standalone
> commit (`fix(engine): support embedded \${var} interpolation in
> RunContext.resolve`) before continuing Task 6, using the same TDD cycle:
> failing tests added to `packages/engine/test/context.test.ts` (two for
> embedded substitution, one confirming the existing whole-string/raw-type
> behavior is preserved), then the fix itself — replace the single anchored
> regex check with a whole-match check (unchanged behavior, returns the raw
> value) followed by a global-replace fallback for embedded occurrences
> (substitutes each `${var}` with `String(value)`). Confirmed with the user
> before making this change, since it touches Core outside this spec's
> reviewed scope.

- [ ] **Step 1: Add the `runner-api` dependency to the server package**

In `packages/server/package.json`, change:

```json
  "dependencies": {
    "@ai-native-testing/engine": "workspace:*",
    "@ai-native-testing/runner-log": "workspace:*",
    "fastify": "^5.1.0"
  },
```

to:

```json
  "dependencies": {
    "@ai-native-testing/engine": "workspace:*",
    "@ai-native-testing/runner-log": "workspace:*",
    "@ai-native-testing/runner-api": "workspace:*",
    "fastify": "^5.1.0"
  },
```

Run: `pnpm install`
Expected: no errors.

- [ ] **Step 2: Write a failing end-to-end test for the REST flow**

Create `packages/server/test/rest-flow.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { buildApp } from '../src/app.js';

interface FakePaymentServer {
  url: string;
  close: () => Promise<void>;
}

async function startFakePaymentApi(): Promise<FakePaymentServer> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      res.setHeader('Content-Type', 'application/json');

      if (req.method === 'POST' && req.url === '/login') {
        res.writeHead(200);
        res.end(JSON.stringify({ data: { accessToken: 'tok-abc' } }));
        return;
      }

      if (req.method === 'POST' && req.url === '/v1/payments') {
        if (req.headers.authorization !== 'Bearer tok-abc') {
          res.writeHead(401);
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        JSON.parse(body); // proves the request body was sent as valid JSON
        res.writeHead(201);
        res.end(JSON.stringify({ data: { paymentId: 'pay-123' } }));
        return;
      }

      if (req.method === 'GET' && req.url === '/v1/payments/pay-123') {
        res.writeHead(200);
        res.end(JSON.stringify({ data: { status: 'SUCCESS' } }));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('failed to determine fake payment API address');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function pollUntilFinished(app: ReturnType<typeof buildApp>, jobId: string) {
  for (let i = 0; i < 50; i++) {
    const res = await app.inject({ method: 'GET', url: `/runs/${jobId}` });
    const body = res.json();
    if (body.status === 'passed' || body.status === 'failed') {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('job did not finish in time');
}

describe('REST flow end-to-end', () => {
  let api: FakePaymentServer | undefined;

  afterEach(async () => {
    await api?.close();
    api = undefined;
  });

  it('runs Login -> Create Payment -> Get Payment Status through POST /runs', async () => {
    api = await startFakePaymentApi();
    const app = buildApp();

    const definition = {
      actor: { name: 'Authenticated Customer', abilities: ['rest'] },
      variables: {
        baseUrl: api.url,
        orderId: 'order-1',
        amount: 49.99,
      },
      tasks: [
        {
          name: 'Login',
          steps: [
            { type: 'interaction', runner: 'rest', action: 'request', with: { method: 'POST', url: '${baseUrl}/login', body: {} } },
            { type: 'question', runner: 'rest', action: 'status', expect: { equals: 200 } },
            { type: 'extract', runner: 'rest', action: 'jsonPath', with: { path: '$.data.accessToken' }, remember: 'accessToken' },
          ],
        },
        {
          name: 'Create Payment',
          steps: [
            {
              type: 'interaction',
              runner: 'rest',
              action: 'request',
              with: {
                method: 'POST',
                url: '${baseUrl}/v1/payments',
                auth: { type: 'bearer', token: '${accessToken}' },
                body: { orderId: '${orderId}', amount: '${amount}' },
              },
            },
            { type: 'question', runner: 'rest', action: 'status', expect: { equals: 201 } },
            { type: 'extract', runner: 'rest', action: 'jsonPath', with: { path: '$.data.paymentId' }, remember: 'paymentId' },
          ],
        },
        {
          name: 'Get Payment Status',
          steps: [
            {
              type: 'interaction',
              runner: 'rest',
              action: 'request',
              with: {
                method: 'GET',
                url: '${baseUrl}/v1/payments/${paymentId}',
                auth: { type: 'bearer', token: '${accessToken}' },
              },
            },
            { type: 'question', runner: 'rest', action: 'jsonPath', with: { path: '$.data.status' }, expect: { equals: 'SUCCESS' } },
          ],
        },
      ],
    };

    const submit = await app.inject({ method: 'POST', url: '/runs', payload: definition });
    expect(submit.statusCode).toBe(202);
    const { jobId } = submit.json();

    const job = await pollUntilFinished(app, jobId);
    expect(job.status).toBe('passed');
    expect(job.steps.every((s: { status: string }) => s.status === 'passed')).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @ai-native-testing/server test`
Expected: the new test FAILS — `runner: 'rest'` is not yet registered in `buildApp()`, so every step in the flow fails at dispatch with "No runner registered with name \"rest\"", and `job.status` ends up `'failed'`, not `'passed'`.

- [ ] **Step 4: Register `RestRunner` in the app**

In `packages/server/src/app.ts`, change:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { RunnerRegistry } from '@ai-native-testing/engine';
import { LogRunner } from '@ai-native-testing/runner-log';
import { JobStore } from './job-store.js';
import { registerRunRoutes } from './routes/runs.js';

export function buildApp(): FastifyInstance {
  const app = Fastify();
  const registry = new RunnerRegistry();
  registry.register(new LogRunner());
  const jobStore = new JobStore();

  registerRunRoutes(app, jobStore, registry);

  return app;
}
```

to:

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

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @ai-native-testing/server test`
Expected: PASS (all tests, including the new end-to-end REST flow test).

- [ ] **Step 6: Run the full workspace test suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS across all packages (`engine`, `runner-log`, `runner-api`, `server`).

- [ ] **Step 7: Commit**

```bash
git add packages/server/package.json packages/server/src/app.ts packages/server/test/rest-flow.test.ts pnpm-lock.yaml
git commit -m "feat(server): register RestRunner and cover REST flow end-to-end"
```
