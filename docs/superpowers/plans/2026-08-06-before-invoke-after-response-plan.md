# Before Invoke / After Response Params Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Before invoke" (same list as the existing Variables section) and "After response" (key/value rows whose value can reference `${response...}`) tabs to Simple Mode's Request card, plus a `$now` dynamic value and icon-style (`+`/`✕`) key/value row controls everywhere.

**Architecture:** Nearly everything reuses existing machinery — the engine's `RunContext.resolveValue` gains dot/bracket-path support by delegating to its own already-tested `extractJsonPath`; "After response" rows become `log`/`echo` extract steps (no runner change needed, since the dispatcher already resolves a step's `with` object before the runner ever sees it); "Before invoke" is a second UI surface on the existing `variables` array. The one genuinely new wiring risk — confirmed by tracing the real code — is that `results.ts`'s `deriveResults` and `FlowRunner.tsx`'s hand-duplicated step-count formula both assume today's fixed step layout and must be updated for the new step, in three call sites and one formula.

**Tech Stack:** TypeScript, the existing `RunContext`/`extractJsonPath` engine primitives, React, Vitest + React Testing Library.

## Global Constraints

- Templating syntax is `${...}` only (matches the app's one existing mechanism) — never `{{...}}`.
- `${response...}` resolution reuses the engine's existing `extractJsonPath`, not a new parser.
- `HIDDEN_RESPONSE_VARIABLE`'s value changes from `'__response'` to `'response'` — traced: exactly one call site references the literal string; all other references go through the exported constant and are unaffected.
- "After response" rows become `{type: 'extract', runner: 'log', action: 'echo', with: {value: row.value}, remember: row.key}` — no `runner-log` package change, since the dispatcher's existing `ctx.resolve(step.with)` call (before invoking any runner) already does the substitution.
- `$now` resolves in `rowsToRecord` (shared by Params/Headers/Variables/gRPC Metadata) — applies uniformly, not just to Before invoke.
- The icon-style row controls (`✕` remove, `+ Add {label} row`) apply to every `KeyValueRows` usage app-wide. The remove button keeps its exact current `aria-label`; the add button gains an explicit `aria-label` matching its current accessible name exactly, so no existing test needs to change.
- Every place that positionally counts or slices a task's steps (`results.ts`'s `deriveResults`, `FlowRunner.tsx`'s `taskStepCount`) must account for non-blank "After response" rows the same way `dsl.ts`'s `buildTaskSteps` does — filtering blank keys before counting.

---

### Task 1: Engine — dot/bracket-path resolution in `RunContext`

**Files:**
- Modify: `packages/engine/src/context.ts`
- Test: `packages/engine/test/context.test.ts`

**Interfaces:**
- Consumes: `extractJsonPath(value: unknown, path: string): unknown` (existing, `packages/engine/src/json-path.ts`, already exported from the engine's public `index.ts`).
- Produces: no new public API — `RunContext.resolve`'s existing signature/behavior for plain `${varName}` is unchanged; it now additionally handles `${varName.path}` and `${varName.path[0].more}`. Task 3 relies on this being in place before "After response" rows can actually resolve at runtime (though Task 3 itself only needs to build the step correctly — this task is what makes it work end-to-end).

- [ ] **Step 1: Write the failing tests**

Add to `packages/engine/test/context.test.ts`, at the end of the `describe('RunContext', ...)` block (after the existing `'still returns the raw, non-stringified value when the whole string is a single ${var}'` test):

```ts
  it('resolves a ${var.path} reference into a nested property', () => {
    const ctx = new RunContext();
    ctx.remember('response', { body: { foo: 'bar' } });
    expect(ctx.resolve('${response.body.foo}')).toBe('bar');
  });

  it('resolves a ${var.path[0].more} reference with array indexing', () => {
    const ctx = new RunContext();
    ctx.remember('response', { body: { items: [{ id: 'a' }, { id: 'b' }] } });
    expect(ctx.resolve('${response.body.items[1].id}')).toBe('b');
  });

  it('resolves a ${var.path} reference embedded within a larger string', () => {
    const ctx = new RunContext();
    ctx.remember('response', { body: { token: 'abc123' } });
    expect(ctx.resolve('Bearer ${response.body.token}')).toBe('Bearer abc123');
  });

  it('throws when a ${var.path} reference does not resolve to a value', () => {
    const ctx = new RunContext();
    ctx.remember('response', { body: {} });
    expect(() => ctx.resolve('${response.body.missing}')).toThrow(/did not resolve to a value/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/engine test -- context.test.ts`
Expected: the 4 new tests FAIL (current regex is `\w+`-only, so `${response.body.foo}` doesn't match the whole-string pattern and falls through unchanged instead of resolving); all existing tests still PASS.

- [ ] **Step 3: Widen `resolveValue` and add path resolution**

Replace the full contents of `packages/engine/src/context.ts` with:

```ts
import { extractJsonPath } from './json-path.js';

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

  private resolvePathExpression(expr: string): unknown {
    const splitIndex = expr.search(/[.\[]/);
    if (splitIndex === -1) {
      return this.variables.get(expr);
    }
    const varName = expr.slice(0, splitIndex);
    const rest = expr.slice(splitIndex);
    const varValue = this.variables.get(varName);
    return extractJsonPath(varValue, `$${rest}`);
  }

  private resolveValue(value: unknown): unknown {
    if (typeof value === 'string') {
      const wholeMatch = /^\$\{([\w.\[\]]+)\}$/.exec(value);
      if (wholeMatch) {
        return this.resolvePathExpression(wholeMatch[1]);
      }
      if (/\$\{[\w.\[\]]+\}/.test(value)) {
        return value.replace(
          /\$\{([\w.\[\]]+)\}/g,
          (_full, expr: string) => String(this.resolvePathExpression(expr))
        );
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/engine test -- context.test.ts`
Expected: PASS (13 tests — 9 existing + 4 new)

- [ ] **Step 5: Run the full engine test suite and typecheck**

Run: `pnpm --filter @ai-native-testing/engine test`
Run: `pnpm --filter @ai-native-testing/engine typecheck`
Expected: PASS / no errors

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/context.ts packages/engine/test/context.test.ts
git commit -m "feat(engine): resolve \${var.path} dot/bracket expressions via extractJsonPath"
```

---

### Task 2: Icon-style key/value row controls (app-wide)

**Files:**
- Modify: `packages/web/src/components/KeyValueRows.tsx`
- Modify: `packages/web/src/styles.css`
- Test: `packages/web/test/components/KeyValueRows.test.tsx`

**Interfaces:**
- Produces: no prop/type changes to `KeyValueRows` — purely visual. Every existing usage (Params, Headers, Variables, gRPC Metadata) picks this up automatically; Tasks 5/6's new "Before invoke"/"After response" tabs will too, since they also render `KeyValueRows`.

- [ ] **Step 1: Write the failing test**

Add to `packages/web/test/components/KeyValueRows.test.tsx`, at the end of the `describe('KeyValueRows', ...)` block:

```tsx
  it('shows a ✕ remove icon and a + Add row button, both with unchanged accessible names', () => {
    render(
      <KeyValueRows label="Variables" rows={[{ id: '1', key: 'a', value: 'b' }]} onChange={() => {}} />
    );
    expect(screen.getByRole('button', { name: 'Remove Variables row' })).toHaveTextContent('✕');
    expect(screen.getByRole('button', { name: 'Add Variables row' })).toHaveTextContent('+ Add Variables row');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/web test -- KeyValueRows.test.tsx`
Expected: FAIL — the remove button's text content is currently `Remove`, not `✕`; the add button's is `Add Variables row`, not `+ Add Variables row`.

- [ ] **Step 3: Update the component**

Replace the full contents of `packages/web/src/components/KeyValueRows.tsx` with:

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
    <fieldset className="card">
      <legend className="heading-sm">{label}</legend>
      {rows.map((row) => (
        <div key={row.id} className="row">
          <input
            className="text-input"
            aria-label={`${label} key`}
            value={row.key}
            onChange={(e) => updateRow(row.id, 'key', e.target.value)}
          />
          <input
            className="text-input"
            aria-label={`${label} value`}
            value={row.value}
            onChange={(e) => updateRow(row.id, 'value', e.target.value)}
          />
          <button
            type="button"
            className="kv-remove"
            aria-label={`Remove ${label} row`}
            onClick={() => removeRow(row.id)}
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="btn-secondary" aria-label={`Add ${label} row`} onClick={addRow}>
        + Add {label} row
      </button>
    </fieldset>
  );
}
```

- [ ] **Step 4: Add the icon CSS**

Append to the end of `packages/web/src/styles.css`:

```css
/* Key/value row remove icon (Params, Headers, Variables, Metadata, Before invoke, After response) */
.kv-remove {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--color-mute);
  cursor: pointer;
  font-size: 16px;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-full);
}

.kv-remove:hover {
  background: var(--color-surface-soft);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/web test -- KeyValueRows.test.tsx`
Expected: PASS (5 tests — 4 existing + 1 new)

- [ ] **Step 6: Run the full web test suite and typecheck**

Run: `pnpm --filter @ai-native-testing/web test`
Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: PASS / no errors — no other file queries these button names by anything other than accessible name, so nothing else should break.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/KeyValueRows.tsx packages/web/src/styles.css packages/web/test/components/KeyValueRows.test.tsx
git commit -m "feat(web): icon-style +/✕ controls for every key/value row list"
```

---

### Task 3: `afterResponse` field, `$now`, response rename, and step generation in `dsl.ts`

**Files:**
- Modify: `packages/web/src/types.ts`
- Modify: `packages/web/src/dsl.ts`
- Test: `packages/web/test/dsl.test.ts`
- Modify (ripple fix, see Step 7): `packages/web/src/App.tsx`, `packages/web/test/App.test.tsx`, `packages/web/test/steps.test.ts`, `packages/web/test/components/LoadStepSelect.test.tsx`, `packages/web/test/components/ApiAutomationPage.test.tsx`, `packages/web/test/kafkaChecks.test.ts`, `packages/web/test/components/FlowRunner.test.tsx`, `packages/web/test/components/RunButton.test.tsx`, `packages/web/test/components/SaveStepButton.test.tsx`

**Interfaces:**
- Produces: `FormState.afterResponse: KeyValueRow[]` (new field, reuses the existing `KeyValueRow` type — no new type needed). `HIDDEN_RESPONSE_VARIABLE` now equals `'response'`. `buildTaskSteps` appends one `{type: 'extract', runner: 'log', action: 'echo', with: {value}, remember}` step per non-blank `afterResponse` row, after user Extract steps and before Questions. Task 4 (`results.ts`) and Task 5 (`RequestBuilder.tsx`) both consume `FormState.afterResponse` directly.

- [ ] **Step 1: Add the field to `FormState`**

In `packages/web/src/types.ts`, add `afterResponse: KeyValueRow[];` to the `FormState` interface, immediately after `kafkaCheck: KafkaCheckFormState;`.

- [ ] **Step 2: Write the failing tests**

In `packages/web/test/dsl.test.ts`, add `afterResponse: [],` to the `emptyForm()` helper's returned object (after `kafkaCheck: { enabled: false, topic: 'transLogV1' },`), then add these two new `describe` blocks at the end of the file:

```ts
describe('$now dynamic value', () => {
  it('resolves a variable row whose value is exactly $now to the current Unix timestamp', () => {
    const before = Date.now();
    const definition = buildTestDefinition(
      emptyForm({ variables: [{ id: '1', key: 'currentUnixTime', value: '$now' }] })
    );
    const after = Date.now();
    const resolved = Number(definition.variables?.currentUnixTime);
    expect(resolved).toBeGreaterThanOrEqual(before);
    expect(resolved).toBeLessThanOrEqual(after);
  });

  it('leaves a non-$now value untouched', () => {
    const definition = buildTestDefinition(emptyForm({ variables: [{ id: '1', key: 'foo', value: 'bar' }] }));
    expect(definition.variables).toEqual({ foo: 'bar' });
  });
});

describe('afterResponse rows', () => {
  it('appends a log/echo extract step per non-blank row, after user extracts and before questions', () => {
    const definition = buildTestDefinition(
      emptyForm({
        extracts: [{ id: '1', source: 'jsonPath', path: '$.data.paymentId', rememberAs: 'paymentId' }],
        afterResponse: [{ id: '2', key: 'authToken', value: 'Bearer ${response.body.token}' }],
        questions: [{ id: '3', source: 'status', path: '', expected: '200' }],
      })
    );
    const steps = definition.tasks[0].steps;
    expect(steps[3]).toEqual({
      type: 'extract',
      runner: 'log',
      action: 'echo',
      with: { value: 'Bearer ${response.body.token}' },
      remember: 'authToken',
    });
    expect(steps[4].type).toBe('question');
  });

  it('ignores afterResponse rows with an empty key', () => {
    const definition = buildTestDefinition(emptyForm({ afterResponse: [{ id: '1', key: '', value: 'ignored' }] }));
    expect(definition.tasks[0].steps).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- dsl.test.ts`
Expected: FAIL — `$now` isn't resolved yet (variable value stays the literal string `'$now'`), and `afterResponse` rows don't produce any step yet.

- [ ] **Step 4: Update `dsl.ts`**

In `packages/web/src/dsl.ts`:

Change:
```ts
export const HIDDEN_RESPONSE_VARIABLE = '__response';
```
to:
```ts
export const HIDDEN_RESPONSE_VARIABLE = 'response';
```

Change:
```ts
function rowsToRecord(rows: KeyValueRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim() !== '') {
      result[row.key] = row.value;
    }
  }
  return result;
}
```
to:
```ts
function resolveDynamicValue(value: string): string {
  return value === '$now' ? String(Date.now()) : value;
}

function rowsToRecord(rows: KeyValueRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim() !== '') {
      result[row.key] = resolveDynamicValue(row.value);
    }
  }
  return result;
}
```

In `buildTaskSteps`, change:
```ts
export function buildTaskSteps(form: FormState): Step[] {
  const runner = form.protocol === 'grpc' ? 'grpc' : 'rest';
  return [
    buildInteractionStep(form),
    { type: 'extract', runner, action: 'raw', remember: HIDDEN_RESPONSE_VARIABLE },
    ...form.extracts.map((row): Step => {
      const { action, with: withFields } = sourceToStepFields(row.source, row.path);
      return { type: 'extract', runner, action, with: withFields, remember: row.rememberAs };
    }),
    ...form.questions.map((row): Step => {
      const { action, with: withFields } = sourceToStepFields(row.source, row.path);
      return {
        type: 'question',
        runner,
        action,
        with: withFields,
        expect: { equals: parseExpected(row.expected) },
      };
    }),
  ];
}
```
to:
```ts
export function buildTaskSteps(form: FormState): Step[] {
  const runner = form.protocol === 'grpc' ? 'grpc' : 'rest';
  return [
    buildInteractionStep(form),
    { type: 'extract', runner, action: 'raw', remember: HIDDEN_RESPONSE_VARIABLE },
    ...form.extracts.map((row): Step => {
      const { action, with: withFields } = sourceToStepFields(row.source, row.path);
      return { type: 'extract', runner, action, with: withFields, remember: row.rememberAs };
    }),
    ...form.afterResponse
      .filter((row) => row.key.trim() !== '')
      .map((row): Step => ({
        type: 'extract',
        runner: 'log',
        action: 'echo',
        with: { value: row.value },
        remember: row.key,
      })),
    ...form.questions.map((row): Step => {
      const { action, with: withFields } = sourceToStepFields(row.source, row.path);
      return {
        type: 'question',
        runner,
        action,
        with: withFields,
        expect: { equals: parseExpected(row.expected) },
      };
    }),
  ];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- dsl.test.ts`
Expected: PASS (all tests in the file — the existing `HIDDEN_RESPONSE_VARIABLE`-based assertions still pass since they reference the exported constant, not the literal string)

- [ ] **Step 6: Typecheck to find every other `FormState` literal**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: errors in every file that constructs a `FormState` object literal without `afterResponse` — at minimum `App.tsx`'s `initialForm()`, and the `FormState`-literal helpers in `App.test.tsx`, `steps.test.ts`, `LoadStepSelect.test.tsx`, `ApiAutomationPage.test.tsx` (two helpers), `kafkaChecks.test.ts`, `FlowRunner.test.tsx`, `RunButton.test.tsx`, `SaveStepButton.test.tsx`.

- [ ] **Step 7: Fix every other `FormState` literal**

Run `grep -rln "kafkaCheck: { enabled: false, topic: 'transLogV1' }" packages/web/src packages/web/test` to find every file with a `FormState`-shaped helper (this exact line was added to all of them in the prior Kafka increment, so it's now a reliable marker), and add `afterResponse: [],` immediately after that line in each one. Also fix `App.test.tsx`'s untyped `savedSteps['grpc step A']` object literal (the one used by the "navigates to API Automation..." test) — it flows through `RequestBuilder` at runtime despite not being statically typed as `FormState`, so it needs `afterResponse: []` too or that test will crash the same way the `kafkaCheck` omission did in the prior increment; add it after its `questions: [],` line.

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors

- [ ] **Step 8: Run the full web test suite**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS, no regressions

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/types.ts packages/web/src/dsl.ts packages/web/test/dsl.test.ts packages/web/src/App.tsx packages/web/test
git commit -m "feat(web): add afterResponse field, \$now dynamic value, and after-response step generation"
```

---

### Task 4: `results.ts` — surface After response values, fix `FlowRunner`'s step-count formula

**Files:**
- Modify: `packages/web/src/results.ts`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/components/FlowRunner.tsx`
- Modify: `packages/web/src/components/ApiAutomationPage.tsx`
- Test: `packages/web/test/results.test.ts`

**Interfaces:**
- Consumes: `FormState.afterResponse` (Task 3).
- Produces: `deriveResults(extracts: ExtractRow[], afterResponse: KeyValueRow[], variables: Record<string,string>, stepResults: (StepResult|undefined)[]): DerivedResults` — signature gains a new second parameter. Every call site in the codebase is updated in this task; no caller outside this task's file list exists (verified via `grep -rn "deriveResults"` across `packages/web/src`).

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `packages/web/test/results.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { deriveResults } from '../src/results';
import type { ExtractRow, KeyValueRow } from '../src/types';
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
    const result = deriveResults([], [], {}, stepResults);
    expect(result.response).toEqual({
      status: 201,
      headers: { 'content-type': 'application/json' },
      body: { ok: true },
    });
  });

  it('returns a null response when the hidden raw step has not completed', () => {
    const result = deriveResults([], [], {}, [stepResult({ action: 'request' })]);
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
    const result = deriveResults(extracts, [], {}, stepResults);
    expect(result.savedValues).toEqual({ paymentId: 'pay_123' });
  });

  it('merges saved values over seeded variables in context', () => {
    const extracts: ExtractRow[] = [{ id: '1', source: 'status', path: '', rememberAs: 'baseUrl' }];
    const stepResults = [
      stepResult({ action: 'request' }),
      stepResult({ type: 'extract', action: 'raw', actual: { status: 200, headers: {}, body: {} } }),
      stepResult({ type: 'extract', action: 'status', actual: 200 }),
    ];
    const result = deriveResults(extracts, [], { baseUrl: 'https://seed.example.com' }, stepResults);
    expect(result.context).toEqual({ baseUrl: 200 });
  });

  it('excludes the hidden raw step from logs', () => {
    const stepResults = [
      stepResult({ action: 'request' }),
      stepResult({ type: 'extract', action: 'raw', actual: {} }),
      stepResult({ type: 'question', action: 'status', status: 'passed' }),
    ];
    const result = deriveResults([], [], {}, stepResults);
    expect(result.logs).toEqual(['interaction request → passed', 'question status → passed']);
  });

  it('includes the expected/actual values for a failed question in its log line', () => {
    const stepResults = [
      stepResult({ type: 'question', action: 'status', status: 'failed', expected: 200, actual: 404 }),
    ];
    const result = deriveResults([], [], {}, stepResults);
    expect(result.logs).toEqual(['question status → failed (expected 200, got 404)']);
  });

  it('maps afterResponse rows to saved values by index, positioned after extracts', () => {
    const extracts: ExtractRow[] = [
      { id: '1', source: 'jsonPath', path: '$.data.paymentId', rememberAs: 'paymentId' },
    ];
    const afterResponse: KeyValueRow[] = [{ id: '2', key: 'authToken', value: 'Bearer pay_123' }];
    const stepResults = [
      stepResult({ action: 'request' }),
      stepResult({ type: 'extract', action: 'raw', actual: { status: 201, headers: {}, body: {} } }),
      stepResult({ type: 'extract', action: 'jsonPath', actual: 'pay_123' }),
      stepResult({ type: 'extract', action: 'echo', actual: 'Bearer pay_123' }),
    ];
    const result = deriveResults(extracts, afterResponse, {}, stepResults);
    expect(result.savedValues).toEqual({ paymentId: 'pay_123', authToken: 'Bearer pay_123' });
  });

  it('ignores a blank-key afterResponse row when positioning subsequent rows', () => {
    const afterResponse: KeyValueRow[] = [
      { id: '1', key: '', value: 'ignored' },
      { id: '2', key: 'authToken', value: 'Bearer pay_123' },
    ];
    const stepResults = [
      stepResult({ action: 'request' }),
      stepResult({ type: 'extract', action: 'raw', actual: { status: 201, headers: {}, body: {} } }),
      stepResult({ type: 'extract', action: 'echo', actual: 'Bearer pay_123' }),
    ];
    const result = deriveResults([], afterResponse, {}, stepResults);
    expect(result.savedValues).toEqual({ authToken: 'Bearer pay_123' });
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm --filter @ai-native-testing/web test -- results.test.ts`
Expected: the 6 pre-existing tests FAIL too at this point, since they're now called with the new 4-argument signature before `deriveResults` itself is updated — TypeScript would also flag this. This is expected; proceed to Step 3.

- [ ] **Step 3: Update `results.ts`**

Replace the full contents of `packages/web/src/results.ts` with:

```ts
import type { StepResult } from '@ai-native-testing/engine';
import type { ExtractRow, KeyValueRow } from './types';

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
  afterResponse: KeyValueRow[],
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

  const nonBlankAfterResponse = afterResponse.filter((row) => row.key.trim() !== '');
  nonBlankAfterResponse.forEach((row, index) => {
    const result = stepResults[FIRST_EXTRACT_STEP_INDEX + extracts.length + index];
    if (result?.status === 'passed') {
      savedValues[row.key] = result.actual;
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

- [ ] **Step 4: Update the three production call sites**

In `packages/web/src/App.tsx`, change:
```ts
    stepResults.length > 0 ? deriveResults(form.extracts, variablesRecord, stepResults) : null;
```
to:
```ts
    stepResults.length > 0 ? deriveResults(form.extracts, form.afterResponse, variablesRecord, stepResults) : null;
```

In `packages/web/src/components/FlowRunner.tsx`, change:
```ts
function taskStepCount(form: FormState): number {
  return 2 + form.extracts.length + form.questions.length;
}
```
to:
```ts
function taskStepCount(form: FormState): number {
  const afterResponseCount = form.afterResponse.filter((row) => row.key.trim() !== '').length;
  return 2 + form.extracts.length + afterResponseCount + form.questions.length;
}
```
(This is the important fix: `FlowRunner` slices a flat multi-task `stepResults` array using this count as each task's boundary width — without this fix, a flow containing a step with "After response" rows would misattribute later tasks' step results.)

And, a few lines below in the same file, change:
```ts
        const derived: DerivedResults = deriveResults(form.extracts, variablesRecord, slice);
```
to:
```ts
        const derived: DerivedResults = deriveResults(form.extracts, form.afterResponse, variablesRecord, slice);
```

In `packages/web/src/components/ApiAutomationPage.tsx`, there are four call sites — change each:
```ts
        results: deriveResults(entry.form.extracts, variablesRecord, stepResults),
```
to:
```ts
        results: deriveResults(entry.form.extracts, entry.form.afterResponse, variablesRecord, stepResults),
```
(inside `recompute()`), and the two identical occurrences:
```ts
          results: deriveResults(entry.form.extracts, variablesRecord, []),
```
to:
```ts
          results: deriveResults(entry.form.extracts, entry.form.afterResponse, variablesRecord, []),
```
(inside `start()`'s two error branches), and:
```ts
        results: deriveResults(entry.form.extracts, toVariablesRecord(entry.form), []),
```
to:
```ts
        results: deriveResults(entry.form.extracts, entry.form.afterResponse, toVariablesRecord(entry.form), []),
```
(inside `handleRun()`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- results.test.ts`
Expected: PASS (8 tests — 6 existing + 2 new)

- [ ] **Step 6: Run the full web test suite and typecheck**

Run: `pnpm --filter @ai-native-testing/web test`
Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: PASS / no errors

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/results.ts packages/web/src/App.tsx packages/web/src/components/FlowRunner.tsx packages/web/src/components/ApiAutomationPage.tsx packages/web/test/results.test.ts
git commit -m "feat(web): surface After response values in Results Context; fix FlowRunner step-count formula"
```

---

### Task 5: "Before invoke" and "After response" tabs in `RequestBuilder`

**Files:**
- Modify: `packages/web/src/components/RequestBuilder.tsx`
- Modify: `packages/web/src/styles.css`
- Test: `packages/web/test/components/RequestBuilder.test.tsx`

**Interfaces:**
- Consumes: `KeyValueRow` (existing, `../types`).
- Produces: `RequestBuilder` gains `variables: KeyValueRow[]`, `onVariablesChange: (rows: KeyValueRow[]) => void`, `afterResponse: KeyValueRow[]`, `onAfterResponseChange: (rows: KeyValueRow[]) => void` props. Task 6 (`SimpleModePage.tsx`) wires these to `form.variables`/`form.afterResponse`.

- [ ] **Step 1: Write the failing tests**

In `packages/web/test/components/RequestBuilder.test.tsx`, add `variables: [], onVariablesChange: vi.fn(), afterResponse: [], onAfterResponseChange: vi.fn(),` to the `baseProps()` helper's returned object (after `onQuestionsChange: vi.fn(),`), then add these tests at the end of the `describe` block:

```tsx
  it('renders the Before invoke tab bound to the variables prop', async () => {
    render(
      <RequestBuilder
        {...baseProps({ variables: [{ id: '1', key: 'baseUrl', value: 'https://x.example.com' }] })}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Before invoke' }));
    expect(screen.getByDisplayValue('baseUrl')).toBeInTheDocument();
  });

  it('calls onVariablesChange from the Before invoke tab', async () => {
    const onVariablesChange = vi.fn();
    render(<RequestBuilder {...baseProps({ onVariablesChange })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Before invoke' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Before invoke row' }));
    expect(onVariablesChange).toHaveBeenCalledWith([{ id: expect.any(String), key: '', value: '' }]);
  });

  it('renders the Before invoke tab for gRPC too', () => {
    render(<RequestBuilder {...baseProps({ protocol: 'grpc' })} />);
    expect(screen.getByRole('button', { name: 'Before invoke' })).toBeInTheDocument();
  });

  it('renders the After response tab bound to the afterResponse prop and calls onAfterResponseChange', async () => {
    const onAfterResponseChange = vi.fn();
    render(
      <RequestBuilder
        {...baseProps({
          afterResponse: [{ id: '1', key: 'authToken', value: '${response.body.token}' }],
          onAfterResponseChange,
        })}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'After response' }));
    expect(screen.getByDisplayValue('authToken')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add After response row' }));
    expect(onAfterResponseChange).toHaveBeenCalledWith([
      { id: '1', key: 'authToken', value: '${response.body.token}' },
      { id: expect.any(String), key: '', value: '' },
    ]);
  });

  it('shows a hint about ${response...} syntax on the After response tab', async () => {
    render(<RequestBuilder {...baseProps()} />);
    await userEvent.click(screen.getByRole('button', { name: 'After response' }));
    expect(screen.getByText(/response\.body\.foo/)).toBeInTheDocument();
  });

  it('renders the After response tab for gRPC too', async () => {
    render(<RequestBuilder {...baseProps({ protocol: 'grpc' })} />);
    expect(screen.getByRole('button', { name: 'After response' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- RequestBuilder.test.tsx`
Expected: FAIL — no "Before invoke"/"After response" tabs exist yet.

- [ ] **Step 3: Add the props, tabs, and render logic**

In `packages/web/src/components/RequestBuilder.tsx`, add to `RequestBuilderProps` (after `onQuestionsChange: (rows: QuestionRow[]) => void;`, before `kafkaCheck: KafkaCheckFormState;`):

```tsx
  variables: KeyValueRow[];
  onVariablesChange: (rows: KeyValueRow[]) => void;
  afterResponse: KeyValueRow[];
  onAfterResponseChange: (rows: KeyValueRow[]) => void;
```

Add `variables, onVariablesChange, afterResponse, onAfterResponseChange,` to the destructured props (after `onQuestionsChange,`, before `kafkaCheck,`).

Change the tab type unions:
```tsx
type RestTab = 'params' | 'headers' | 'auth' | 'body' | 'curl' | 'extract' | 'questions';
type GrpcTab = 'proto' | 'service' | 'method' | 'message' | 'metadata' | 'grpcurl' | 'extract' | 'questions';
```
to:
```tsx
type RestTab = 'beforeInvoke' | 'params' | 'headers' | 'auth' | 'body' | 'curl' | 'afterResponse' | 'extract' | 'questions';
type GrpcTab = 'beforeInvoke' | 'proto' | 'service' | 'method' | 'message' | 'metadata' | 'grpcurl' | 'afterResponse' | 'extract' | 'questions';
```

Change `REST_TABS`:
```tsx
const REST_TABS: { id: RestTab; label: string }[] = [
  { id: 'params', label: 'Params' },
  { id: 'headers', label: 'Headers' },
  { id: 'auth', label: 'Auth' },
  { id: 'body', label: 'Body' },
  { id: 'curl', label: 'Paste cURL' },
  { id: 'extract', label: 'Extract' },
  { id: 'questions', label: 'Questions' },
];
```
to:
```tsx
const REST_TABS: { id: RestTab; label: string }[] = [
  { id: 'beforeInvoke', label: 'Before invoke' },
  { id: 'params', label: 'Params' },
  { id: 'headers', label: 'Headers' },
  { id: 'auth', label: 'Auth' },
  { id: 'body', label: 'Body' },
  { id: 'curl', label: 'Paste cURL' },
  { id: 'afterResponse', label: 'After response' },
  { id: 'extract', label: 'Extract' },
  { id: 'questions', label: 'Questions' },
];
```

Change `GRPC_TABS`:
```tsx
const GRPC_TABS: { id: GrpcTab; label: string }[] = [
  { id: 'proto', label: 'Proto' },
  { id: 'service', label: 'Service' },
  { id: 'method', label: 'Method' },
  { id: 'message', label: 'Message' },
  { id: 'metadata', label: 'Metadata' },
  { id: 'grpcurl', label: 'Paste grpcurl' },
  { id: 'extract', label: 'Extract' },
  { id: 'questions', label: 'Questions' },
];
```
to:
```tsx
const GRPC_TABS: { id: GrpcTab; label: string }[] = [
  { id: 'beforeInvoke', label: 'Before invoke' },
  { id: 'proto', label: 'Proto' },
  { id: 'service', label: 'Service' },
  { id: 'method', label: 'Method' },
  { id: 'message', label: 'Message' },
  { id: 'metadata', label: 'Metadata' },
  { id: 'grpcurl', label: 'Paste grpcurl' },
  { id: 'afterResponse', label: 'After response' },
  { id: 'extract', label: 'Extract' },
  { id: 'questions', label: 'Questions' },
];
```

In the REST tab-content block, add right after `{restTab === 'params' && ...}`'s opening (i.e. immediately after the `</nav>` closing the REST tab bar, before the existing `{restTab === 'params' && ...}` line):

```tsx
          {restTab === 'beforeInvoke' && (
            <KeyValueRows label="Before invoke" rows={variables} onChange={onVariablesChange} />
          )}
```

and right before `{restTab === 'extract' && <ExtractEditor rows={extracts} onChange={onExtractsChange} />}`:

```tsx
          {restTab === 'afterResponse' && (
            <div className="card">
              <KeyValueRows label="After response" rows={afterResponse} onChange={onAfterResponseChange} />
              <p className="field-hint">
                {'Value can be a literal, or reference the response: ${response.body.foo}, ${response.body.items[0].id}, ${response.headers.x-request-id}, ${response.status}'}
              </p>
            </div>
          )}
```

**Important:** the hint text must be wrapped in a JS string literal inside `{...}` (single quotes, as shown above) rather than written as bare JSX text. In JSX, `{` always starts an embedded expression regardless of what precedes it — bare text like `${response.body.foo}` would make JSX try to evaluate `response.body.foo` as a variable reference (a `ReferenceError`/compile error), since only the outer `{...}` string-literal wrapper prevents that. Do not "simplify" this to plain text.

Do the same in the gRPC tab-content block: add `{grpcTab === 'beforeInvoke' && (<KeyValueRows label="Before invoke" rows={variables} onChange={onVariablesChange} />)}` immediately after the gRPC `</nav>`, before `{grpcTab === 'proto' && ...}`, and add the equivalent `{grpcTab === 'afterResponse' && (...)}` block (identical content and identical string-literal-wrapped hint text, just `grpcTab ===` instead of `restTab ===`) immediately before `{grpcTab === 'extract' && <ExtractEditor rows={extracts} onChange={onExtractsChange} />}`.

- [ ] **Step 4: Add the hint text CSS**

Append to the end of `packages/web/src/styles.css`:

```css
.field-hint {
  font-size: 12px;
  color: var(--color-mute);
  margin: 0;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- RequestBuilder.test.tsx`
Expected: PASS (all tests in the file)

- [ ] **Step 6: Run the full web test suite and typecheck**

Run: `pnpm --filter @ai-native-testing/web test`
Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: FAIL at this point — `SimpleModePage.tsx` doesn't pass the four new required props to `RequestBuilder` yet. This is expected; Task 6 fixes it. Confirm the *only* failures are TypeScript errors on `SimpleModePage.tsx`'s `<RequestBuilder>` usage (missing `variables`/`onVariablesChange`/`afterResponse`/`onAfterResponseChange`) before proceeding.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/RequestBuilder.tsx packages/web/src/styles.css packages/web/test/components/RequestBuilder.test.tsx
git commit -m "feat(web): add Before invoke and After response tabs to RequestBuilder"
```

---

### Task 6: Wire `SimpleModePage` and add the `App.test.tsx` integration test

**Files:**
- Modify: `packages/web/src/components/SimpleModePage.tsx`
- Test: `packages/web/test/App.test.tsx`

**Interfaces:**
- Consumes: `RequestBuilder`'s `variables`/`onVariablesChange`/`afterResponse`/`onAfterResponseChange` props (Task 5), `FormState.afterResponse` (Task 3).
- Produces: nothing new for later tasks — this is the final piece.

- [ ] **Step 1: Write the failing integration test**

Add to `packages/web/test/App.test.tsx`, at the end of the `describe('App', ...)` block:

```tsx
  it('carries a Before invoke variable into the run and shows an After response value in the Results Context tab', async () => {
    const fetchMock = stubNameListFetch({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await userEvent.type(screen.getByLabelText('Task'), 'Create Payment');
    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://api.example.com/v1/payments/${orderId}' },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Before invoke' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Before invoke row' }));
    fireEvent.change(screen.getByLabelText('Before invoke key'), { target: { value: 'orderId' } });
    fireEvent.change(screen.getByLabelText('Before invoke value'), { target: { value: 'order-1' } });

    await userEvent.click(screen.getByRole('button', { name: 'After response' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add After response row' }));
    fireEvent.change(screen.getByLabelText('After response key'), { target: { value: 'authToken' } });
    fireEvent.change(screen.getByLabelText('After response value'), { target: { value: 'Bearer abc' } });

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    const runsCall = fetchMock.mock.calls.find(([url]) => url === '/runs');
    const body = JSON.parse((runsCall?.[1] as RequestInit).body as string);
    expect(body.variables).toEqual({ orderId: 'order-1' });
    expect(body.tasks[0].steps[0].with.url).toBe('https://api.example.com/v1/payments/${orderId}');
    expect(body.tasks[0].steps[2]).toEqual({
      type: 'extract',
      runner: 'log',
      action: 'echo',
      with: { value: 'Bearer abc' },
      remember: 'authToken',
    });

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
      result: { type: 'extract', runner: 'log', action: 'echo', status: 'passed', actual: 'Bearer abc' },
    });
    source.emit({ type: 'run:completed' });

    await userEvent.click(screen.getByRole('button', { name: 'Context' }));
    expect(await screen.findByText(/authToken/)).toBeInTheDocument();
    expect(screen.getByText(/Bearer abc/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/web test -- App.test.tsx`
Expected: FAIL — `RequestBuilder` requires `variables`/`onVariablesChange`/`afterResponse`/`onAfterResponseChange` (Task 5), but `SimpleModePage` doesn't pass them yet, so `variables`/`afterResponse` arrive as `undefined` and the component crashes on render (the same class of failure seen with the `kafkaCheck` prop in the prior increment).

- [ ] **Step 3: Wire the props**

In `packages/web/src/components/SimpleModePage.tsx`, add to the `<RequestBuilder>` element's props, after `onQuestionsChange={(questions) => onFormChange((prev) => ({ ...prev, questions }))}` and before `kafkaCheck={form.kafkaCheck}`:

```tsx
        variables={form.variables}
        onVariablesChange={(variables) => onFormChange((prev) => ({ ...prev, variables }))}
        afterResponse={form.afterResponse}
        onAfterResponseChange={(afterResponse) => onFormChange((prev) => ({ ...prev, afterResponse }))}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/web test -- App.test.tsx`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Run the full workspace test suite and typecheck**

Run: `pnpm test`
Run: `pnpm typecheck`
Expected: PASS / no errors, across every package.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/SimpleModePage.tsx packages/web/test/App.test.tsx
git commit -m "feat(web): wire Before invoke / After response into SimpleModePage"
```

---

## Final Verification

1. Run `pnpm test` and `pnpm typecheck` from the repo root — confirm zero failures across all packages.
2. Manually verify in the browser (restart the backend first if it's been running a while — see the "no --watch" gotcha):
   - In Simple Mode, open "Before invoke," add a row (e.g. `currentUnixTime` → `$now`), confirm it also appears in the top-level "Variables" section (same list, two entry points).
   - Reference it in the URL or body as `${currentUnixTime}`, run against a real safe endpoint (e.g. `jsonplaceholder.typicode.com`, never real ZaloPay data), and confirm the actual outgoing request used a real resolved timestamp (inspect via the endpoint's echo behavior, or a request-logging proxy, or just trust the already-covered unit tests if no echo endpoint is convenient).
   - Open "After response," add a row referencing `${response.body.<a real field the endpoint returns>}` or `${response.status}`, run, and confirm the Results panel's "Context" tab shows the resolved value.
   - Confirm the `+`/`✕` icons render correctly (not as broken/missing glyphs) in a real browser for Params, Headers, Variables, Metadata, and the two new tabs.
   - Try referencing a response path that doesn't exist (e.g. `${response.body.nonexistentField}`) and confirm the run fails with a clear error rather than silently succeeding with `"undefined"`.
3. Clean up any test data written to `packages/server/data/*.json` afterward, per this session's established convention.
