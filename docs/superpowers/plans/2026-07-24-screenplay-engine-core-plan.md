# Screenplay Engine (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Screenplay Engine (Core) backend — a TypeScript service that accepts a declarative JSON test definition, executes it asynchronously as a job through a Task Dispatcher, and exposes results via a Fastify API, with a Runner plugin interface proven by one trivial example runner.

**Architecture:** A pnpm workspace monorepo with three packages: `engine` (domain types, RunContext/Variables, Runner interface, Task Dispatcher, DSL schema validation), `runner-log` (example `LogRunner` implementing the Runner interface), and `server` (Fastify app, in-memory Job Store, HTTP routes). The Dispatcher is a tree-walking interpreter that flattens nested Tasks into a linear step list, resolves `${var}` references via RunContext, dispatches each step to the named Runner, and emits lifecycle events (`step:started`, `step:completed`, `step:failed`, `run:completed`, `run:failed`) that the Job Store consumes to build point-in-time snapshots and replay/stream via SSE.

**Tech Stack:** TypeScript (strict, ESM, NodeNext), pnpm workspaces, Vitest, Fastify, Ajv (JSON Schema validation), tsx (dev/run).

Spec: [`docs/superpowers/specs/2026-07-24-screenplay-engine-core-design.md`](../specs/2026-07-24-screenplay-engine-core-design.md)

## Global Constraints

- Node.js >= 20 (uses built-in `crypto.randomUUID`).
- Package manager: pnpm, workspace layout under `packages/*`.
- TypeScript strict mode, ESM (`"type": "module"`), `module`/`moduleResolution: "NodeNext"` — all relative imports must use explicit `.js` extensions (even though the files are `.ts`), per NodeNext convention.
- Test framework: Vitest (`vitest run`), test files under each package's `test/` directory.
- Web framework: Fastify (server package only).
- Persistence: in-memory only — no database. Job history is lost on process restart (per spec's "Persistence" section).
- Failure handling: fail-fast — on the first failed Interaction/Question, the run stops immediately and all remaining steps are marked `skipped` (per spec's "Failure handling — fail-fast" section).
- Explicitly out of scope (do not implement): real Runners other than the example `LogRunner`, a persistent database, auth/authz, the visual builder UI, multi-tenant concerns, retry/backoff policies, pause/resume of a run, reuse of a Task definition across separate test definitions.

---

### Task 1: Workspace Scaffold & RunContext (Variables Store)

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `packages/engine/package.json`
- Create: `packages/engine/tsconfig.json`
- Create: `packages/engine/src/context.ts`
- Create: `packages/engine/src/index.ts`
- Test: `packages/engine/test/context.test.ts`

**Interfaces:**
- Produces: `RunContext` class (`packages/engine/src/context.ts`) with `remember(name: string, value: unknown): void`, `get(name: string): unknown`, `resolve<T>(value: T): T`. Exported from `@ai-native-testing/engine` via `src/index.ts`.

- [ ] **Step 1: Create the pnpm workspace file**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 2: Create the root package.json**

Create `package.json`:

```json
{
  "name": "ai-native-testing",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "test": "pnpm -r run test",
    "typecheck": "pnpm -r run typecheck"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 3: Create the base TypeScript config**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "noEmit": true
  }
}
```

- [ ] **Step 4: Create .gitignore**

Create `.gitignore`:

```
node_modules/
dist/
```

- [ ] **Step 5: Create the engine package manifest**

Create `packages/engine/package.json`:

```json
{
  "name": "@ai-native-testing/engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 6: Create the engine package tsconfig**

Create `packages/engine/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

- [ ] **Step 7: Install dependencies**

Run: `pnpm install`
Expected: installs successfully, creates `pnpm-lock.yaml` and `node_modules/`.

- [ ] **Step 8: Write the failing test for RunContext**

Create `packages/engine/test/context.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RunContext } from '../src/context.js';

describe('RunContext', () => {
  it('returns undefined for a variable that was never remembered', () => {
    const ctx = new RunContext();
    expect(ctx.get('missing')).toBeUndefined();
  });

  it('remembers and retrieves a variable', () => {
    const ctx = new RunContext();
    ctx.remember('paymentId', 'pay_123');
    expect(ctx.get('paymentId')).toBe('pay_123');
  });

  it('resolves a plain string unchanged', () => {
    const ctx = new RunContext();
    expect(ctx.resolve('hello')).toBe('hello');
  });

  it('resolves a ${var} reference to the remembered value', () => {
    const ctx = new RunContext();
    ctx.remember('statusCode', 201);
    expect(ctx.resolve('${statusCode}')).toBe(201);
  });

  it('resolves ${var} references inside nested objects and arrays', () => {
    const ctx = new RunContext();
    ctx.remember('paymentId', 'pay_123');
    const resolved = ctx.resolve({
      body: { id: '${paymentId}' },
      tags: ['${paymentId}', 'static'],
    });
    expect(resolved).toEqual({
      body: { id: 'pay_123' },
      tags: ['pay_123', 'static'],
    });
  });

  it('resolves an unset ${var} reference to undefined', () => {
    const ctx = new RunContext();
    expect(ctx.resolve('${missing}')).toBeUndefined();
  });
});
```

- [ ] **Step 9: Run the test to verify it fails**

Run: `pnpm --filter @ai-native-testing/engine test`
Expected: FAIL — cannot find module `../src/context.js`.

- [ ] **Step 10: Implement RunContext**

Create `packages/engine/src/context.ts`:

```ts
export class RunContext {
  private variables = new Map<string, unknown>();

  remember(name: string, value: unknown): void {
    this.variables.set(name, value);
  }

  get(name: string): unknown {
    return this.variables.get(name);
  }

  resolve<T>(value: T): T {
    return this.resolveValue(value) as T;
  }

  private resolveValue(value: unknown): unknown {
    if (typeof value === 'string') {
      const match = /^\$\{(\w+)\}$/.exec(value);
      if (match) {
        return this.variables.get(match[1]);
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.resolveValue(item));
    }
    if (value !== null && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        result[key] = this.resolveValue(val);
      }
      return result;
    }
    return value;
  }
}
```

- [ ] **Step 11: Create the package entry point**

Create `packages/engine/src/index.ts`:

```ts
export { RunContext } from './context.js';
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `pnpm --filter @ai-native-testing/engine test`
Expected: PASS — 6 tests passed.

- [ ] **Step 13: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json .gitignore packages/engine
git commit -m "feat(engine): scaffold workspace and add RunContext"
```

---

### Task 2: Runner Interface & RunnerRegistry

**Files:**
- Create: `packages/engine/src/runner.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/runner.test.ts`

**Interfaces:**
- Consumes: `RunContext` from `./context.js` (Task 1).
- Produces: `Runner` interface and `RunnerRegistry` class (`packages/engine/src/runner.ts`), both re-exported from `@ai-native-testing/engine`. `Runner` shape: `{ name: string; interact(action: string, args: Record<string, unknown>, ctx: RunContext): Promise<void>; ask(action: string, args: Record<string, unknown>, ctx: RunContext): Promise<unknown>; }`. `RunnerRegistry` methods: `register(runner: Runner): void`, `get(name: string): Runner` (throws if not found).

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/runner.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RunnerRegistry, type Runner } from '../src/runner.js';
import { RunContext } from '../src/context.js';

function makeStubRunner(name: string): Runner {
  return {
    name,
    async interact() {},
    async ask() {
      return null;
    },
  };
}

describe('RunnerRegistry', () => {
  it('registers and retrieves a runner by name', () => {
    const registry = new RunnerRegistry();
    const runner = makeStubRunner('log');
    registry.register(runner);
    expect(registry.get('log')).toBe(runner);
  });

  it('throws when getting an unregistered runner name', () => {
    const registry = new RunnerRegistry();
    expect(() => registry.get('missing')).toThrow('No runner registered with name "missing"');
  });

  it('passes a RunContext instance through to runner methods', async () => {
    const ctx = new RunContext();
    let received: RunContext | undefined;
    const runner: Runner = {
      name: 'probe',
      async interact(_action, _args, runCtx) {
        received = runCtx;
      },
      async ask() {
        return null;
      },
    };
    await runner.interact('noop', {}, ctx);
    expect(received).toBe(ctx);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/engine test`
Expected: FAIL — cannot find module `../src/runner.js`.

- [ ] **Step 3: Implement Runner and RunnerRegistry**

Create `packages/engine/src/runner.ts`:

```ts
import type { RunContext } from './context.js';

export interface Runner {
  name: string;
  interact(action: string, args: Record<string, unknown>, ctx: RunContext): Promise<void>;
  ask(action: string, args: Record<string, unknown>, ctx: RunContext): Promise<unknown>;
}

export class RunnerRegistry {
  private runners = new Map<string, Runner>();

  register(runner: Runner): void {
    this.runners.set(runner.name, runner);
  }

  get(name: string): Runner {
    const runner = this.runners.get(name);
    if (!runner) {
      throw new Error(`No runner registered with name "${name}"`);
    }
    return runner;
  }
}
```

- [ ] **Step 4: Update the package entry point**

Modify `packages/engine/src/index.ts` to:

```ts
export { RunContext } from './context.js';
export { RunnerRegistry, type Runner } from './runner.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/engine test`
Expected: PASS — 9 tests passed (6 from Task 1 + 3 new).

- [ ] **Step 6: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): add Runner interface and RunnerRegistry"
```

---

### Task 3: DSL Types, Step Flattening & Schema Validation

**Files:**
- Create: `packages/engine/src/types.ts`
- Create: `packages/engine/src/flatten.ts`
- Create: `packages/engine/src/schema.ts`
- Modify: `packages/engine/package.json` (add `ajv` dependency)
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/flatten.test.ts`
- Test: `packages/engine/test/schema.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1–2 (pure data types + validation).
- Produces (all re-exported from `@ai-native-testing/engine`):
  - Types: `Actor`, `InteractionStep`, `QuestionStep`, `TaskStep`, `Step`, `LeafStep`, `TaskDefinition`, `TestDefinition`, `StepResult` (`status: 'pending' | 'passed' | 'failed' | 'skipped'`), `RunEvent`.
  - `flattenSteps(steps: Step[]): LeafStep[]`.
  - `validateTestDefinition(input: unknown): { valid: boolean; errors?: string[] }`.

- [ ] **Step 1: Write the failing test for flattenSteps**

Create `packages/engine/test/flatten.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { flattenSteps } from '../src/flatten.js';
import type { Step } from '../src/types.js';

describe('flattenSteps', () => {
  it('returns interaction and question steps unchanged when there is no nesting', () => {
    const steps: Step[] = [
      { type: 'interaction', runner: 'log', action: 'log', with: { message: 'hi' } },
      { type: 'question', runner: 'log', action: 'echo', with: { value: 1 }, expect: { equals: 1 } },
    ];
    expect(flattenSteps(steps)).toEqual(steps);
  });

  it('flattens a nested task step into its leaf steps, preserving order', () => {
    const inner1: Step = { type: 'interaction', runner: 'log', action: 'log', with: { message: 'a' } };
    const inner2: Step = { type: 'question', runner: 'log', action: 'echo', with: { value: 2 }, expect: { equals: 2 } };
    const steps: Step[] = [{ type: 'task', name: 'Nested', steps: [inner1, inner2] }];
    expect(flattenSteps(steps)).toEqual([inner1, inner2]);
  });

  it('flattens multiple levels of nested tasks', () => {
    const leaf: Step = { type: 'interaction', runner: 'log', action: 'log', with: { message: 'deep' } };
    const steps: Step[] = [
      { type: 'task', name: 'Outer', steps: [{ type: 'task', name: 'Inner', steps: [leaf] }] },
    ];
    expect(flattenSteps(steps)).toEqual([leaf]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/engine test`
Expected: FAIL — cannot find module `../src/flatten.js` (and `../src/types.js`).

- [ ] **Step 3: Implement the DSL types**

Create `packages/engine/src/types.ts`:

```ts
export interface Actor {
  name: string;
  abilities: string[];
}

export interface InteractionStep {
  type: 'interaction';
  runner: string;
  action: string;
  with?: Record<string, unknown>;
}

export interface QuestionStep {
  type: 'question';
  runner: string;
  action: string;
  with?: Record<string, unknown>;
  expect: { equals: unknown };
  remember?: string;
}

export interface TaskStep {
  type: 'task';
  name: string;
  steps: Step[];
}

export type Step = InteractionStep | QuestionStep | TaskStep;
export type LeafStep = InteractionStep | QuestionStep;

export interface TaskDefinition {
  name: string;
  steps: Step[];
}

export interface TestDefinition {
  actor: Actor;
  tasks: TaskDefinition[];
}

export interface StepResult {
  type: 'interaction' | 'question';
  runner: string;
  action: string;
  status: 'pending' | 'passed' | 'failed' | 'skipped';
  args?: Record<string, unknown>;
  actual?: unknown;
  expected?: unknown;
  error?: string;
}

export type RunEvent =
  | { type: 'step:started'; index: number; step: LeafStep }
  | { type: 'step:completed'; index: number; result: StepResult }
  | { type: 'step:failed'; index: number; result: StepResult }
  | { type: 'run:completed' }
  | { type: 'run:failed'; error: string };
```

- [ ] **Step 4: Implement flattenSteps**

Create `packages/engine/src/flatten.ts`:

```ts
import type { Step, LeafStep } from './types.js';

export function flattenSteps(steps: Step[]): LeafStep[] {
  const result: LeafStep[] = [];
  for (const step of steps) {
    if (step.type === 'task') {
      result.push(...flattenSteps(step.steps));
    } else {
      result.push(step);
    }
  }
  return result;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/engine test`
Expected: PASS — flatten tests pass (schema tests not yet written).

- [ ] **Step 6: Write the failing test for schema validation**

Create `packages/engine/test/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateTestDefinition } from '../src/schema.js';

const validDefinition = {
  actor: { name: 'Authenticated Customer', abilities: ['log'] },
  tasks: [
    {
      name: 'Create Payment',
      steps: [
        { type: 'interaction', runner: 'log', action: 'log', with: { message: 'creating payment' } },
        { type: 'question', runner: 'log', action: 'echo', with: { value: 201 }, expect: { equals: 201 }, remember: 'statusCode' },
        { type: 'question', runner: 'log', action: 'echo', with: { value: '${statusCode}' }, expect: { equals: 201 } },
      ],
    },
  ],
};

describe('validateTestDefinition', () => {
  it('accepts a well-formed test definition', () => {
    expect(validateTestDefinition(validDefinition)).toEqual({ valid: true });
  });

  it('rejects a definition missing the actor field', () => {
    const { actor, ...withoutActor } = validDefinition;
    const result = validateTestDefinition(withoutActor);
    expect(result.valid).toBe(false);
    expect(result.errors?.length).toBeGreaterThan(0);
  });

  it('rejects an interaction step missing the action field', () => {
    const invalid = {
      actor: validDefinition.actor,
      tasks: [{ name: 'Bad', steps: [{ type: 'interaction', runner: 'log', with: {} }] }],
    };
    expect(validateTestDefinition(invalid).valid).toBe(false);
  });

  it('rejects a question step missing the expect field', () => {
    const invalid = {
      actor: validDefinition.actor,
      tasks: [{ name: 'Bad', steps: [{ type: 'question', runner: 'log', action: 'echo', with: {} }] }],
    };
    expect(validateTestDefinition(invalid).valid).toBe(false);
  });

  it('accepts a definition with a nested task step', () => {
    const nested = {
      actor: validDefinition.actor,
      tasks: [
        {
          name: 'Outer',
          steps: [
            {
              type: 'task',
              name: 'Inner',
              steps: [{ type: 'interaction', runner: 'log', action: 'log', with: { message: 'nested' } }],
            },
          ],
        },
      ],
    };
    expect(validateTestDefinition(nested)).toEqual({ valid: true });
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/engine test`
Expected: FAIL — cannot find module `../src/schema.js`.

- [ ] **Step 8: Add the ajv dependency**

Modify `packages/engine/package.json` — replace the `dependencies`-less manifest with one that includes `ajv`:

```json
{
  "name": "@ai-native-testing/engine",
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
    "ajv": "^8.17.1"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

Run: `pnpm install`
Expected: installs `ajv` into `packages/engine`.

- [ ] **Step 9: Implement schema validation**

Create `packages/engine/src/schema.ts`:

```ts
import Ajv, { type ErrorObject } from 'ajv';

const stepSchema = {
  $id: 'step',
  oneOf: [
    {
      type: 'object',
      required: ['type', 'runner', 'action'],
      additionalProperties: false,
      properties: {
        type: { const: 'interaction' },
        runner: { type: 'string' },
        action: { type: 'string' },
        with: { type: 'object' },
      },
    },
    {
      type: 'object',
      required: ['type', 'runner', 'action', 'expect'],
      additionalProperties: false,
      properties: {
        type: { const: 'question' },
        runner: { type: 'string' },
        action: { type: 'string' },
        with: { type: 'object' },
        expect: {
          type: 'object',
          required: ['equals'],
          additionalProperties: false,
          properties: { equals: {} },
        },
        remember: { type: 'string' },
      },
    },
    {
      type: 'object',
      required: ['type', 'name', 'steps'],
      additionalProperties: false,
      properties: {
        type: { const: 'task' },
        name: { type: 'string' },
        steps: { type: 'array', items: { $ref: 'step' } },
      },
    },
  ],
} as const;

const taskDefinitionSchema = {
  $id: 'taskDefinition',
  type: 'object',
  required: ['name', 'steps'],
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    steps: { type: 'array', minItems: 1, items: { $ref: 'step' } },
  },
} as const;

const testDefinitionSchema = {
  $id: 'testDefinition',
  type: 'object',
  required: ['actor', 'tasks'],
  additionalProperties: false,
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
} as const;

const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addSchema(stepSchema);
ajv.addSchema(taskDefinitionSchema);
const validateFn = ajv.compile(testDefinitionSchema);

export function validateTestDefinition(input: unknown): { valid: boolean; errors?: string[] } {
  const valid = validateFn(input);
  if (valid) {
    return { valid: true };
  }
  return { valid: false, errors: formatErrors(validateFn.errors) };
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message}`);
}
```

- [ ] **Step 10: Update the package entry point**

Modify `packages/engine/src/index.ts` to:

```ts
export { RunContext } from './context.js';
export { RunnerRegistry, type Runner } from './runner.js';
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
export { flattenSteps } from './flatten.js';
export { validateTestDefinition } from './schema.js';
```

- [ ] **Step 11: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/engine test`
Expected: PASS — all flatten and schema tests pass.

- [ ] **Step 12: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): add DSL types, step flattening, and schema validation"
```

---

### Task 4: Task Dispatcher (Execution Engine)

**Files:**
- Create: `packages/engine/src/dispatcher.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/dispatcher.test.ts`

**Interfaces:**
- Consumes: `RunContext` (Task 1), `Runner`/`RunnerRegistry` (Task 2), `TestDefinition`/`LeafStep`/`StepResult`/`RunEvent`/`flattenSteps` (Task 3).
- Produces: `runDefinition(definition: TestDefinition, registry: RunnerRegistry): RunHandle` where `RunHandle = { emitter: EventEmitter; done: Promise<{ status: 'passed' | 'failed' }> }`. Re-exported from `@ai-native-testing/engine`.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/test/dispatcher.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { runDefinition } from '../src/dispatcher.js';
import { RunnerRegistry, type Runner } from '../src/runner.js';
import type { TestDefinition, RunEvent } from '../src/types.js';
import type { EventEmitter } from 'node:events';

function collectEvents(emitter: EventEmitter): RunEvent[] {
  const events: RunEvent[] = [];
  emitter.on('event', (e: RunEvent) => events.push(e));
  return events;
}

describe('runDefinition', () => {
  it('runs a passing interaction and question, remembering the answer', async () => {
    const askMock = vi.fn().mockResolvedValue(201);
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
          name: 'Create Payment',
          steps: [
            { type: 'interaction', runner: 'log', action: 'log', with: { message: 'hi' } },
            { type: 'question', runner: 'log', action: 'echo', with: { value: 201 }, expect: { equals: 201 }, remember: 'statusCode' },
            { type: 'question', runner: 'log', action: 'echo', with: { value: '${statusCode}' }, expect: { equals: 201 } },
          ],
        },
      ],
    };

    const { emitter, done } = runDefinition(definition, registry);
    const events = collectEvents(emitter);
    const result = await done;

    expect(result).toEqual({ status: 'passed' });
    expect(events.at(-1)).toEqual({ type: 'run:completed' });
    expect(askMock).toHaveBeenNthCalledWith(1, 'echo', { value: 201 }, expect.anything());
    expect(askMock).toHaveBeenNthCalledWith(2, 'echo', { value: 201 }, expect.anything());
  });

  it('stops at the first failed question and skips remaining steps', async () => {
    const interactMock = vi.fn().mockResolvedValue(undefined);
    const runner: Runner = {
      name: 'log',
      interact: interactMock,
      ask: vi.fn().mockResolvedValue(500),
    };
    const registry = new RunnerRegistry();
    registry.register(runner);

    const definition: TestDefinition = {
      actor: { name: 'Customer', abilities: ['log'] },
      tasks: [
        {
          name: 'Create Payment',
          steps: [
            { type: 'question', runner: 'log', action: 'echo', with: { value: 500 }, expect: { equals: 201 } },
            { type: 'interaction', runner: 'log', action: 'log', with: { message: 'should not run' } },
          ],
        },
      ],
    };

    const { emitter, done } = runDefinition(definition, registry);
    const events = collectEvents(emitter);
    const result = await done;

    expect(result).toEqual({ status: 'failed' });
    expect(interactMock).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'step:failed')).toBe(true);
    expect(events.at(-1)?.type).toBe('run:failed');
  });

  it('marks the run as failed when a runner throws', async () => {
    const runner: Runner = {
      name: 'log',
      interact: vi.fn().mockRejectedValue(new Error('boom')),
      ask: vi.fn().mockResolvedValue(null),
    };
    const registry = new RunnerRegistry();
    registry.register(runner);

    const definition: TestDefinition = {
      actor: { name: 'Customer', abilities: ['log'] },
      tasks: [{ name: 'T', steps: [{ type: 'interaction', runner: 'log', action: 'log', with: {} }] }],
    };

    const { done } = runDefinition(definition, registry);
    const result = await done;
    expect(result).toEqual({ status: 'failed' });
  });

  it('flattens nested task steps before executing', async () => {
    const askMock = vi.fn().mockResolvedValue(1);
    const runner: Runner = { name: 'log', interact: vi.fn().mockResolvedValue(undefined), ask: askMock };
    const registry = new RunnerRegistry();
    registry.register(runner);

    const definition: TestDefinition = {
      actor: { name: 'Customer', abilities: ['log'] },
      tasks: [
        {
          name: 'Outer',
          steps: [
            {
              type: 'task',
              name: 'Inner',
              steps: [{ type: 'question', runner: 'log', action: 'echo', with: { value: 1 }, expect: { equals: 1 } }],
            },
          ],
        },
      ],
    };

    const { done } = runDefinition(definition, registry);
    const result = await done;
    expect(result).toEqual({ status: 'passed' });
    expect(askMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/engine test`
Expected: FAIL — cannot find module `../src/dispatcher.js`.

- [ ] **Step 3: Implement the Task Dispatcher**

Create `packages/engine/src/dispatcher.ts`:

```ts
import { EventEmitter } from 'node:events';
import { RunContext } from './context.js';
import type { RunnerRegistry } from './runner.js';
import { flattenSteps } from './flatten.js';
import type { TestDefinition, StepResult, RunEvent, LeafStep } from './types.js';

export interface RunHandle {
  emitter: EventEmitter;
  done: Promise<{ status: 'passed' | 'failed' }>;
}

export function runDefinition(definition: TestDefinition, registry: RunnerRegistry): RunHandle {
  const emitter = new EventEmitter();
  const ctx = new RunContext();
  const steps = definition.tasks.flatMap((task) => flattenSteps(task.steps));

  const done = executeSteps(steps, ctx, registry, emitter);

  return { emitter, done };
}

async function executeSteps(
  steps: LeafStep[],
  ctx: RunContext,
  registry: RunnerRegistry,
  emitter: EventEmitter
): Promise<{ status: 'passed' | 'failed' }> {
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    emitter.emit('event', { type: 'step:started', index, step } satisfies RunEvent);

    const runner = registry.get(step.runner);
    const args = ctx.resolve(step.with ?? {});

    try {
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
        const passed = actual === expected;
        if (step.remember) {
          ctx.remember(step.remember, actual);
        }
        const result: StepResult = {
          type: 'question',
          runner: step.runner,
          action: step.action,
          status: passed ? 'passed' : 'failed',
          args,
          actual,
          expected,
        };
        if (passed) {
          emitter.emit('event', { type: 'step:completed', index, result } satisfies RunEvent);
        } else {
          emitter.emit('event', { type: 'step:failed', index, result } satisfies RunEvent);
          emitter.emit('event', {
            type: 'run:failed',
            error: `Question "${step.action}" failed: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
          } satisfies RunEvent);
          return { status: 'failed' };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const result: StepResult = {
        type: step.type,
        runner: step.runner,
        action: step.action,
        status: 'failed',
        args,
        error: message,
      };
      emitter.emit('event', { type: 'step:failed', index, result } satisfies RunEvent);
      emitter.emit('event', { type: 'run:failed', error: message } satisfies RunEvent);
      return { status: 'failed' };
    }
  }

  emitter.emit('event', { type: 'run:completed' } satisfies RunEvent);
  return { status: 'passed' };
}
```

- [ ] **Step 4: Update the package entry point**

Modify `packages/engine/src/index.ts` to add the dispatcher export:

```ts
export { RunContext } from './context.js';
export { RunnerRegistry, type Runner } from './runner.js';
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
export { flattenSteps } from './flatten.js';
export { validateTestDefinition } from './schema.js';
export { runDefinition, type RunHandle } from './dispatcher.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/engine test`
Expected: PASS — all dispatcher tests pass, full engine suite green.

- [ ] **Step 6: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): add Task Dispatcher with fail-fast execution and event emission"
```

---

### Task 5: Example LogRunner Package

**Files:**
- Create: `packages/runner-log/package.json`
- Create: `packages/runner-log/tsconfig.json`
- Create: `packages/runner-log/src/index.ts`
- Test: `packages/runner-log/test/log-runner.test.ts`

**Interfaces:**
- Consumes: `Runner`, `RunContext` from `@ai-native-testing/engine` (Tasks 1–2).
- Produces: `LogRunner` class implementing `Runner`, with `name = 'log'`, a public `logs: string[]` array, `interact('log', { message })` (pushes `message` to `logs`), and `ask('echo', { value })` (returns `value` unchanged). Both methods throw on any other `action` name.

- [ ] **Step 1: Create the runner-log package manifest**

Create `packages/runner-log/package.json`:

```json
{
  "name": "@ai-native-testing/runner-log",
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
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2: Create the runner-log package tsconfig**

Create `packages/runner-log/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Install dependencies**

Run: `pnpm install`
Expected: pnpm links `@ai-native-testing/engine` into `packages/runner-log/node_modules`.

- [ ] **Step 4: Write the failing test**

Create `packages/runner-log/test/log-runner.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RunContext } from '@ai-native-testing/engine';
import { LogRunner } from '../src/index.js';

describe('LogRunner', () => {
  const ctx = new RunContext();

  it('records a logged message', async () => {
    const runner = new LogRunner();
    await runner.interact('log', { message: 'hello' }, ctx);
    expect(runner.logs).toEqual(['hello']);
  });

  it('echoes back the given value', async () => {
    const runner = new LogRunner();
    const result = await runner.ask('echo', { value: 42 }, ctx);
    expect(result).toBe(42);
  });

  it('rejects an unknown interaction action', async () => {
    const runner = new LogRunner();
    await expect(runner.interact('unknown', {}, ctx)).rejects.toThrow(
      'LogRunner does not support interaction "unknown"'
    );
  });

  it('rejects an unknown question action', async () => {
    const runner = new LogRunner();
    await expect(runner.ask('unknown', {}, ctx)).rejects.toThrow(
      'LogRunner does not support question "unknown"'
    );
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/runner-log test`
Expected: FAIL — cannot find module `../src/index.js`.

- [ ] **Step 6: Implement LogRunner**

Create `packages/runner-log/src/index.ts`:

```ts
import type { Runner, RunContext } from '@ai-native-testing/engine';

export class LogRunner implements Runner {
  name = 'log';
  public readonly logs: string[] = [];

  async interact(action: string, args: Record<string, unknown>, _ctx: RunContext): Promise<void> {
    if (action !== 'log') {
      throw new Error(`LogRunner does not support interaction "${action}"`);
    }
    this.logs.push(String(args.message));
  }

  async ask(action: string, args: Record<string, unknown>, _ctx: RunContext): Promise<unknown> {
    if (action !== 'echo') {
      throw new Error(`LogRunner does not support question "${action}"`);
    }
    return args.value;
  }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/runner-log test`
Expected: PASS — 4 tests passed.

- [ ] **Step 8: Commit**

```bash
git add packages/runner-log
git commit -m "feat(runner-log): add example LogRunner implementing the Runner interface"
```

---

### Task 6: Server Scaffold & Job Store

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/src/job-store.ts`
- Test: `packages/server/test/job-store.test.ts`

**Interfaces:**
- Consumes: `RunnerRegistry`, `Runner`, `runDefinition`, `flattenSteps`, `TestDefinition`, `StepResult`, `RunEvent` from `@ai-native-testing/engine` (Tasks 1–4).
- Produces: `JobState` interface (`{ jobId: string; status: 'pending' | 'running' | 'passed' | 'failed'; steps: StepResult[]; createdAt: string; finishedAt?: string }`) and `JobStore` class with `createJob(definition: TestDefinition, registry: RunnerRegistry): string`, `getJob(jobId: string): JobState | undefined`, `getHistory(jobId: string): RunEvent[]`, `subscribe(jobId: string, listener: (event: RunEvent) => void): () => void`.

- [ ] **Step 1: Create the server package manifest**

Create `packages/server/package.json`:

```json
{
  "name": "@ai-native-testing/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ai-native-testing/engine": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2: Create the server package tsconfig**

Create `packages/server/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Install dependencies**

Run: `pnpm install`
Expected: pnpm links `@ai-native-testing/engine` into `packages/server/node_modules`.

- [ ] **Step 4: Write the failing test**

Create `packages/server/test/job-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RunnerRegistry, type Runner, type TestDefinition, type RunEvent } from '@ai-native-testing/engine';
import { JobStore } from '../src/job-store.js';

function makeStubRunner(): Runner {
  return {
    name: 'log',
    async interact() {},
    async ask(_action, args) {
      return (args as { value: unknown }).value;
    },
  };
}

function makeRegistry(runner: Runner): RunnerRegistry {
  const registry = new RunnerRegistry();
  registry.register(runner);
  return registry;
}

function waitForFinish(store: JobStore, jobId: string): Promise<RunEvent> {
  return new Promise((resolve) => {
    const unsubscribe = store.subscribe(jobId, (event) => {
      if (event.type === 'run:completed' || event.type === 'run:failed') {
        unsubscribe();
        resolve(event);
      }
    });
  });
}

const passingDefinition: TestDefinition = {
  actor: { name: 'Customer', abilities: ['log'] },
  tasks: [
    {
      name: 'Create Payment',
      steps: [
        { type: 'interaction', runner: 'log', action: 'log', with: { message: 'hi' } },
        { type: 'question', runner: 'log', action: 'echo', with: { value: 201 }, expect: { equals: 201 } },
      ],
    },
  ],
};

const failingDefinition: TestDefinition = {
  actor: { name: 'Customer', abilities: ['log'] },
  tasks: [
    {
      name: 'Create Payment',
      steps: [
        { type: 'question', runner: 'log', action: 'echo', with: { value: 500 }, expect: { equals: 201 } },
        { type: 'interaction', runner: 'log', action: 'log', with: { message: 'unreachable' } },
      ],
    },
  ],
};

describe('JobStore', () => {
  it('creates a job in the running state with pending steps', () => {
    const store = new JobStore();
    const jobId = store.createJob(passingDefinition, makeRegistry(makeStubRunner()));
    const job = store.getJob(jobId);
    expect(job?.status).toBe('running');
    expect(job?.steps).toHaveLength(2);
    expect(job?.steps.every((s) => s.status === 'pending')).toBe(true);
  });

  it('marks a job passed with all steps passed once execution finishes', async () => {
    const store = new JobStore();
    const jobId = store.createJob(passingDefinition, makeRegistry(makeStubRunner()));
    await waitForFinish(store, jobId);
    const job = store.getJob(jobId);
    expect(job?.status).toBe('passed');
    expect(job?.steps.every((s) => s.status === 'passed')).toBe(true);
    expect(job?.finishedAt).toBeDefined();
  });

  it('marks remaining steps skipped when a job fails fast', async () => {
    const store = new JobStore();
    const jobId = store.createJob(failingDefinition, makeRegistry(makeStubRunner()));
    await waitForFinish(store, jobId);
    const job = store.getJob(jobId);
    expect(job?.status).toBe('failed');
    expect(job?.steps[0].status).toBe('failed');
    expect(job?.steps[1].status).toBe('skipped');
  });

  it('records event history that can be replayed', async () => {
    const store = new JobStore();
    const jobId = store.createJob(passingDefinition, makeRegistry(makeStubRunner()));
    await waitForFinish(store, jobId);
    const history = store.getHistory(jobId);
    expect(history.at(-1)).toEqual({ type: 'run:completed' });
  });

  it('returns undefined for an unknown job id', () => {
    const store = new JobStore();
    expect(store.getJob('does-not-exist')).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/server test`
Expected: FAIL — cannot find module `../src/job-store.js`.

- [ ] **Step 6: Implement JobStore**

Create `packages/server/src/job-store.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  runDefinition,
  flattenSteps,
  type TestDefinition,
  type StepResult,
  type RunEvent,
  type RunnerRegistry,
} from '@ai-native-testing/engine';

export interface JobState {
  jobId: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  steps: StepResult[];
  createdAt: string;
  finishedAt?: string;
}

export class JobStore {
  private jobs = new Map<string, JobState>();
  private emitters = new Map<string, EventEmitter>();
  private history = new Map<string, RunEvent[]>();

  createJob(definition: TestDefinition, registry: RunnerRegistry): string {
    const jobId = randomUUID();
    const steps: StepResult[] = definition.tasks
      .flatMap((task) => flattenSteps(task.steps))
      .map((step) => ({
        type: step.type,
        runner: step.runner,
        action: step.action,
        status: 'pending' as const,
      }));

    const job: JobState = {
      jobId,
      status: 'running',
      steps,
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(jobId, job);
    this.history.set(jobId, []);

    const jobEmitter = new EventEmitter();
    this.emitters.set(jobId, jobEmitter);

    const { emitter, done } = runDefinition(definition, registry);

    emitter.on('event', (event: RunEvent) => {
      this.history.get(jobId)!.push(event);
      this.applyEvent(job, event);
      jobEmitter.emit('event', event);
    });

    done.then((result) => {
      job.status = result.status;
      job.finishedAt = new Date().toISOString();
    });

    return jobId;
  }

  getJob(jobId: string): JobState | undefined {
    return this.jobs.get(jobId);
  }

  getHistory(jobId: string): RunEvent[] {
    return this.history.get(jobId) ?? [];
  }

  subscribe(jobId: string, listener: (event: RunEvent) => void): () => void {
    const emitter = this.emitters.get(jobId);
    if (!emitter) {
      return () => {};
    }
    emitter.on('event', listener);
    return () => emitter.off('event', listener);
  }

  private applyEvent(job: JobState, event: RunEvent): void {
    switch (event.type) {
      case 'step:completed':
      case 'step:failed':
        job.steps[event.index] = event.result;
        break;
      case 'run:failed':
        for (const step of job.steps) {
          if (step.status === 'pending') {
            step.status = 'skipped';
          }
        }
        break;
    }
  }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/server test`
Expected: PASS — 5 tests passed.

- [ ] **Step 8: Commit**

```bash
git add packages/server
git commit -m "feat(server): add in-memory JobStore wired to the Task Dispatcher"
```

---

### Task 7: Fastify App, Routes & Bootstrap

**Files:**
- Modify: `packages/server/package.json` (add `fastify`, `tsx` dependencies and `dev`/`start` scripts)
- Create: `packages/server/src/routes/runs.ts`
- Create: `packages/server/src/app.ts`
- Create: `packages/server/src/index.ts`
- Test: `packages/server/test/runs.test.ts`

**Interfaces:**
- Consumes: `JobStore`/`JobState` (Task 6), `RunnerRegistry`/`validateTestDefinition` from `@ai-native-testing/engine` (Tasks 2–3), `LogRunner` from `@ai-native-testing/runner-log` (Task 5).
- Produces: `buildApp(): FastifyInstance` (`packages/server/src/app.ts`), exposing `POST /runs`, `GET /runs/:jobId`, `GET /runs/:jobId/events`. `packages/server/src/index.ts` boots the app with `app.listen`.

- [ ] **Step 1: Add fastify and tsx dependencies**

Modify `packages/server/package.json` to:

```json
{
  "name": "@ai-native-testing/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ai-native-testing/engine": "workspace:*",
    "@ai-native-testing/runner-log": "workspace:*",
    "fastify": "^5.1.0"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.4",
    "tsx": "^4.19.2"
  }
}
```

Run: `pnpm install`
Expected: installs `fastify`, `tsx`, and links `@ai-native-testing/runner-log`.

- [ ] **Step 2: Write the failing test**

Create `packages/server/test/runs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';

const validDefinition = {
  actor: { name: 'Customer', abilities: ['log'] },
  tasks: [
    {
      name: 'Create Payment',
      steps: [
        { type: 'interaction', runner: 'log', action: 'log', with: { message: 'hi' } },
        { type: 'question', runner: 'log', action: 'echo', with: { value: 201 }, expect: { equals: 201 } },
      ],
    },
  ],
};

const failingDefinition = {
  actor: { name: 'Customer', abilities: ['log'] },
  tasks: [
    {
      name: 'Create Payment',
      steps: [{ type: 'question', runner: 'log', action: 'echo', with: { value: 500 }, expect: { equals: 201 } }],
    },
  ],
};

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

describe('POST /runs', () => {
  it('accepts a valid test definition and returns a jobId', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: '/runs', payload: validDefinition });
    expect(res.statusCode).toBe(202);
    expect(res.json().jobId).toEqual(expect.any(String));
  });

  it('rejects an invalid test definition with 400 and errors', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: '/runs', payload: { tasks: [] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors.length).toBeGreaterThan(0);
  });
});

describe('GET /runs/:jobId', () => {
  it('returns 404 for an unknown job', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/runs/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });

  it('reports a passed job with all steps passed', async () => {
    const app = buildApp();
    const submit = await app.inject({ method: 'POST', url: '/runs', payload: validDefinition });
    const { jobId } = submit.json();
    const job = await pollUntilFinished(app, jobId);
    expect(job.status).toBe('passed');
    expect(job.steps.every((s: { status: string }) => s.status === 'passed')).toBe(true);
  });

  it('reports a failed job with skipped remaining steps', async () => {
    const app = buildApp();
    const submit = await app.inject({ method: 'POST', url: '/runs', payload: failingDefinition });
    const { jobId } = submit.json();
    const job = await pollUntilFinished(app, jobId);
    expect(job.status).toBe('failed');
    expect(job.steps[0].status).toBe('failed');
  });
});

describe('GET /runs/:jobId/events', () => {
  it('streams recorded events as server-sent events once the job has finished', async () => {
    const app = buildApp();
    const submit = await app.inject({ method: 'POST', url: '/runs', payload: validDefinition });
    const { jobId } = submit.json();
    await pollUntilFinished(app, jobId);

    const res = await app.inject({ method: 'GET', url: `/runs/${jobId}/events` });
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.payload).toContain('"type":"run:completed"');
  });

  it('returns 404 for an unknown job', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/runs/does-not-exist/events' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/server test`
Expected: FAIL — cannot find module `../src/app.js`.

- [ ] **Step 4: Implement the routes**

Create `packages/server/src/routes/runs.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { validateTestDefinition, type RunnerRegistry, type TestDefinition } from '@ai-native-testing/engine';
import type { JobStore } from '../job-store.js';

export function registerRunRoutes(app: FastifyInstance, jobStore: JobStore, registry: RunnerRegistry): void {
  app.post('/runs', async (request, reply) => {
    const { valid, errors } = validateTestDefinition(request.body);
    if (!valid) {
      return reply.code(400).send({ errors });
    }
    const jobId = jobStore.createJob(request.body as TestDefinition, registry);
    return reply.code(202).send({ jobId });
  });

  app.get('/runs/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = jobStore.getJob(jobId);
    if (!job) {
      return reply.code(404).send({ error: 'job not found' });
    }
    return reply.send(job);
  });

  app.get('/runs/:jobId/events', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = jobStore.getJob(jobId);
    if (!job) {
      return reply.code(404).send({ error: 'job not found' });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    for (const event of jobStore.getHistory(jobId)) {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    if (job.status === 'passed' || job.status === 'failed') {
      reply.raw.end();
      return;
    }

    const unsubscribe = jobStore.subscribe(jobId, (event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === 'run:completed' || event.type === 'run:failed') {
        reply.raw.end();
      }
    });

    request.raw.on('close', unsubscribe);
  });
}
```

- [ ] **Step 5: Implement the Fastify app builder**

Create `packages/server/src/app.ts`:

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

- [ ] **Step 6: Implement the bootstrap entry point**

Create `packages/server/src/index.ts`:

```ts
import { buildApp } from './app.js';

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: '0.0.0.0' }).then(() => {
  app.log.info(`server listening on port ${port}`);
});
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/server test`
Expected: PASS — all 8 route tests pass.

- [ ] **Step 8: Run the full workspace test and typecheck suites**

Run: `pnpm -r run typecheck && pnpm -r run test`
Expected: all packages typecheck cleanly and all tests pass across `engine`, `runner-log`, and `server`.

- [ ] **Step 9: Manual smoke test**

Run: `pnpm --filter @ai-native-testing/server start` (in one terminal), then in another:

```bash
curl -s -X POST http://localhost:3000/runs \
  -H 'content-type: application/json' \
  -d '{"actor":{"name":"Customer","abilities":["log"]},"tasks":[{"name":"Create Payment","steps":[{"type":"interaction","runner":"log","action":"log","with":{"message":"hi"}},{"type":"question","runner":"log","action":"echo","with":{"value":201},"expect":{"equals":201}}]}]}'
```

Expected: `202` response with a `jobId`. Then `curl http://localhost:3000/runs/<jobId>` returns `"status":"passed"` with both steps `"passed"`. Stop the server (Ctrl+C) when done.

- [ ] **Step 10: Commit**

```bash
git add packages/server
git commit -m "feat(server): add Fastify app with run submission, polling, and SSE routes"
```

---

## Completion Criteria

- `pnpm -r run typecheck` passes with no errors across all three packages.
- `pnpm -r run test` passes with no failures across all three packages.
- The manual smoke test in Task 7, Step 9 produces a `passed` job via real HTTP calls.
