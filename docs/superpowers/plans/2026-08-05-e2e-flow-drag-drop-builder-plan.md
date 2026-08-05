# E2E Flow Drag-and-Drop Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the End-to-end test page's plain "pick an existing flow and run it" UI with a real flow builder: list every saved API, drag-and-drop to set/edit the execution order, and only enable "Run Flow"/"Save Flow" once a valid order is in place.

**Architecture:** `FlowStore` gains `setSteps` (replaces a flow's entire step list, distinct from the existing append-only `addStep`) behind a new `PUT /flows/:name` route. `FlowRunner` gains a new `flowOrder` state (the source of truth for both what's rendered and what actually runs) and a new `stepNames` prop; `availableSteps` is never separately stored, always computed as `stepNames.filter(name => !flowOrder.includes(name))`. A new presentational component, `FlowStepOrderEditor`, handles the two-column drag-and-drop UI via native HTML5 drag events (no new dependency) and reports the result as one computed array through a single `onFlowOrderChange` callback.

**Tech Stack:** TypeScript, React 18, native HTML5 drag-and-drop (`draggable`, `onDragStart`/`onDragOver`/`onDrop`), Vitest, React Testing Library.

Spec: [`docs/superpowers/specs/2026-08-05-e2e-flow-drag-drop-builder-design.md`](../specs/2026-08-05-e2e-flow-drag-drop-builder-design.md)

## Global Constraints

- Each saved step can appear at most once per flow — dragging it into Flow Order removes it from Available APIs; removing it (via ✕) returns it to Available APIs. No repeats.
- "Save Flow" and "Run Flow" are both disabled while Flow Order is empty. "Save Flow" is additionally disabled while a new flow's name field is blank. No other gating condition (in particular, Run Flow does NOT require Save Flow to have been clicked first).
- "Run Flow" always executes the *current* `flowOrder` state directly — never re-fetches the flow's steps from the server at run time. This is a deliberate behavior change from today (which re-fetches via `fetchFlow` inside `handleRun`).
- Switching the Flow picker to a different flow (or to "+ New Flow") silently discards any unsaved reordering — no confirmation prompt, consistent with every other selection switch in this app (e.g. `LoadStepSelect`).
- `AddToFlowButton` on Simple Mode is unchanged — it remains a separate, quick "append one step to a flow" shortcut, untouched by this plan.
- No drag-and-drop library — native HTML5 DnD only, verified working in this project's exact Vitest+jsdom setup via `fireEvent.dragStart`/`dragOver`/`drop` with no `dataTransfer` mocking needed (a plain React-state-tracked "currently dragged step name" is sufficient).
- No new colors in `styles.css` — reuse existing tokens only.

---

### Task 1: Flow step-order persistence (server + client)

**Files:**
- Modify: `packages/server/src/flow-store.ts`
- Modify: `packages/server/test/flow-store.test.ts`
- Modify: `packages/server/src/routes/flows.ts`
- Modify: `packages/server/test/flows-routes.test.ts`
- Modify: `packages/web/src/flows.ts`
- Modify: `packages/web/test/flows.test.ts`

**Interfaces:**
- Produces: `FlowStore.setSteps(flowName: string, stepNames: string[]): Promise<string[]>`. `PUT /flows/:name` (body `{ stepNames: string[] }`, response `{ names: string[] }`). `setFlow(name: string, stepNames: string[]): Promise<string[] | undefined>` (client). All consumed by `FlowRunner` (Task 3).

- [ ] **Step 1: Write failing tests for `FlowStore.setSteps`**

In `packages/server/test/flow-store.test.ts`, add this block at the end of the file, right before the final closing `});` of the `describe('FlowStore', ...)` block:

```ts

  it("replaces an existing flow's steps via setSteps", async () => {
    const store = new FlowStore(join(dir, 'flows.json'));
    await store.addStep('Transfer money by wallet', 'Check Balance');
    await store.addStep('Transfer money by wallet', 'Transfer Money');

    const names = await store.setSteps('Transfer money by wallet', ['Transfer Money', 'Check Balance']);
    expect(names).toEqual(['Transfer money by wallet']);
    expect(await store.get('Transfer money by wallet')).toEqual(['Transfer Money', 'Check Balance']);
  });

  it('creates a new flow via setSteps if it does not exist yet', async () => {
    const store = new FlowStore(join(dir, 'flows.json'));
    const names = await store.setSteps('Brand New Flow', ['Login', 'Check Balance']);
    expect(names).toEqual(['Brand New Flow']);
    expect(await store.get('Brand New Flow')).toEqual(['Login', 'Check Balance']);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test -- flow-store.test`
Expected: FAIL — `FlowStore.setSteps` does not exist yet.

- [ ] **Step 3: Implement `setSteps`**

In `packages/server/src/flow-store.ts`, change:

```ts
  async addStep(flowName: string, stepName: string): Promise<string[]> {
    const map = await this.readMap();
    const steps = map[flowName] ?? [];
    steps.push(stepName);
    map[flowName] = steps;
    await this.write(map);
    return Object.keys(map);
  }
```

to:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test -- flow-store.test`
Expected: PASS (all 7 tests — 5 existing plus the 2 new ones).

- [ ] **Step 5: Write failing tests for `PUT /flows/:name`**

In `packages/server/test/flows-routes.test.ts`, add this block at the end of the file, right after the closing `});` of the `describe('GET /flows/:name', ...)` block:

```ts

describe('PUT /flows/:name', () => {
  it("replaces the flow's step list and returns the updated flow names", async () => {
    const app = await buildTestApp();
    await app.inject({
      method: 'POST',
      url: '/flows',
      payload: { flowName: 'Transfer money by wallet', stepName: 'Check Balance' },
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/flows/Transfer%20money%20by%20wallet',
      payload: { stepNames: ['Transfer Money', 'Check Balance'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ names: ['Transfer money by wallet'] });

    const getRes = await app.inject({ method: 'GET', url: '/flows/Transfer%20money%20by%20wallet' });
    expect(getRes.json()).toEqual(['Transfer Money', 'Check Balance']);
  });

  it('creates a new flow if it does not exist yet', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/flows/Brand%20New%20Flow',
      payload: { stepNames: ['Login'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ names: ['Brand New Flow'] });
  });

  it('rejects a non-array stepNames with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/flows/Some%20Flow',
      payload: { stepNames: 'not-an-array' },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test -- flows-routes.test`
Expected: FAIL — `PUT /flows/:name` doesn't exist yet (404).

- [ ] **Step 7: Implement the route**

In `packages/server/src/routes/flows.ts`, change:

```ts
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

to:

```ts
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
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test -- flows-routes.test`
Expected: PASS (all tests, including the 3 new ones).

- [ ] **Step 9: Typecheck the server package**

Run: `pnpm --filter @ai-native-testing/server typecheck`
Expected: no errors.

- [ ] **Step 10: Write failing tests for the client `setFlow` function**

In `packages/web/test/flows.test.ts`, change the import line:

```ts
import { fetchFlowNames, fetchFlow, addStepToFlow } from '../src/flows';
```

to:

```ts
import { fetchFlowNames, fetchFlow, addStepToFlow, setFlow } from '../src/flows';
```

Then add this block at the end of the file, right before the final closing `});` of the `describe('addStepToFlow', ...)` block's closing brace (i.e., after it, as a sibling top-level `describe`):

```ts

describe('setFlow', () => {
  it('PUTs the flow name and step names, returning the updated flow names list', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ names: ['Transfer money by wallet'] }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await setFlow('Transfer money by wallet', ['Check Balance', 'Transfer Money']);

    expect(fetchMock).toHaveBeenCalledWith('/flows/Transfer%20money%20by%20wallet', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepNames: ['Check Balance', 'Transfer Money'] }),
    });
    expect(result).toEqual(['Transfer money by wallet']);
  });

  it('returns undefined when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await setFlow('Transfer money by wallet', ['Check Balance'])).toBeUndefined();
  });

  it('returns undefined when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await setFlow('Transfer money by wallet', ['Check Balance'])).toBeUndefined();
  });
});
```

- [ ] **Step 11: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- flows.test`
Expected: FAIL — `setFlow` is not exported from `../src/flows` yet.

- [ ] **Step 12: Implement `setFlow`**

In `packages/web/src/flows.ts`, add this function at the end of the file:

```ts

export async function setFlow(name: string, stepNames: string[]): Promise<string[] | undefined> {
  try {
    const response = await fetch(`/flows/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepNames }),
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

- [ ] **Step 13: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- flows.test`
Expected: PASS (all tests, including the 3 new ones).

- [ ] **Step 14: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/server/src/flow-store.ts packages/server/test/flow-store.test.ts packages/server/src/routes/flows.ts packages/server/test/flows-routes.test.ts packages/web/src/flows.ts packages/web/test/flows.test.ts
git commit -m "feat(server,web): add flow step-order persistence (setSteps / PUT /flows/:name / setFlow)"
```

---

### Task 2: `FlowStepOrderEditor` component

**Files:**
- Create: `packages/web/src/components/FlowStepOrderEditor.tsx`
- Create: `packages/web/test/components/FlowStepOrderEditor.test.tsx`
- Modify: `packages/web/src/styles.css`

**Interfaces:**
- Produces: `FlowStepOrderEditor` (props: `availableSteps: string[]`, `flowOrder: string[]`, `onFlowOrderChange: (next: string[]) => void`). Consumed by `FlowRunner` (Task 3).

- [ ] **Step 1: Write failing tests**

Create `packages/web/test/components/FlowStepOrderEditor.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FlowStepOrderEditor } from '../../src/components/FlowStepOrderEditor';

describe('FlowStepOrderEditor', () => {
  it('renders available steps and flow order steps in their respective columns', () => {
    render(
      <FlowStepOrderEditor
        availableSteps={['Get User']}
        flowOrder={['Check Balance', 'Transfer Money']}
        onFlowOrderChange={vi.fn()}
      />
    );
    expect(screen.getByText('Get User')).toBeInTheDocument();
    expect(screen.getByText('Check Balance')).toBeInTheDocument();
    expect(screen.getByText('Transfer Money')).toBeInTheDocument();
  });

  it('adds an available step to the end of flow order when dropped on the trailing drop zone', () => {
    const onFlowOrderChange = vi.fn();
    render(
      <FlowStepOrderEditor
        availableSteps={['Get User']}
        flowOrder={['Check Balance']}
        onFlowOrderChange={onFlowOrderChange}
      />
    );
    fireEvent.dragStart(screen.getByText('Get User'));
    fireEvent.dragOver(screen.getByText('Drop here to add'));
    fireEvent.drop(screen.getByText('Drop here to add'));
    expect(onFlowOrderChange).toHaveBeenCalledWith(['Check Balance', 'Get User']);
  });

  it('inserts an available step before the row it is dropped on', () => {
    const onFlowOrderChange = vi.fn();
    render(
      <FlowStepOrderEditor
        availableSteps={['Get User']}
        flowOrder={['Check Balance', 'Transfer Money']}
        onFlowOrderChange={onFlowOrderChange}
      />
    );
    fireEvent.dragStart(screen.getByText('Get User'));
    fireEvent.dragOver(screen.getByText('Transfer Money'));
    fireEvent.drop(screen.getByText('Transfer Money'));
    expect(onFlowOrderChange).toHaveBeenCalledWith(['Check Balance', 'Get User', 'Transfer Money']);
  });

  it('reorders within flow order when an already-included step is dragged to a new position', () => {
    const onFlowOrderChange = vi.fn();
    render(
      <FlowStepOrderEditor
        availableSteps={[]}
        flowOrder={['Check Balance', 'Transfer Money', 'Confirm Transfer']}
        onFlowOrderChange={onFlowOrderChange}
      />
    );
    fireEvent.dragStart(screen.getByText('Check Balance'));
    fireEvent.dragOver(screen.getByText('Confirm Transfer'));
    fireEvent.drop(screen.getByText('Confirm Transfer'));
    expect(onFlowOrderChange).toHaveBeenCalledWith(['Transfer Money', 'Check Balance', 'Confirm Transfer']);
  });

  it('removes a step from flow order when its remove button is clicked', () => {
    const onFlowOrderChange = vi.fn();
    render(
      <FlowStepOrderEditor
        availableSteps={[]}
        flowOrder={['Check Balance', 'Transfer Money']}
        onFlowOrderChange={onFlowOrderChange}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove Check Balance from flow' }));
    expect(onFlowOrderChange).toHaveBeenCalledWith(['Transfer Money']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- FlowStepOrderEditor.test`
Expected: FAIL — `../../src/components/FlowStepOrderEditor` does not exist.

- [ ] **Step 3: Implement `FlowStepOrderEditor`**

Create `packages/web/src/components/FlowStepOrderEditor.tsx`:

```tsx
import { useState } from 'react';

export interface FlowStepOrderEditorProps {
  availableSteps: string[];
  flowOrder: string[];
  onFlowOrderChange: (next: string[]) => void;
}

function reorder(flowOrder: string[], draggedStep: string, dropIndex: number): string[] {
  const fromIndex = flowOrder.indexOf(draggedStep);
  const next = flowOrder.filter((name) => name !== draggedStep);
  let insertAt = dropIndex;
  if (fromIndex !== -1 && fromIndex < dropIndex) {
    insertAt -= 1;
  }
  next.splice(insertAt, 0, draggedStep);
  return next;
}

export function FlowStepOrderEditor({ availableSteps, flowOrder, onFlowOrderChange }: FlowStepOrderEditorProps) {
  const [draggedStep, setDraggedStep] = useState<string | null>(null);

  function handleDrop(dropIndex: number) {
    if (draggedStep === null) {
      return;
    }
    onFlowOrderChange(reorder(flowOrder, draggedStep, dropIndex));
    setDraggedStep(null);
  }

  return (
    <div className="flow-builder">
      <div className="card">
        <h3 className="heading-sm">All APIs</h3>
        <ul className="flow-step-list">
          {availableSteps.map((name) => (
            <li key={name} className="flow-step-row" draggable onDragStart={() => setDraggedStep(name)}>
              {name}
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h3 className="heading-sm">Flow Order</h3>
        <ul className="flow-step-list">
          {flowOrder.map((name, index) => (
            <li
              key={name}
              className="flow-step-row flow-step-row--ordered"
              draggable
              onDragStart={() => setDraggedStep(name)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(index)}
            >
              <span className="flow-step-index">{index + 1}</span>
              {name}
              <button
                type="button"
                className="flow-step-remove"
                aria-label={`Remove ${name} from flow`}
                onClick={() => onFlowOrderChange(flowOrder.filter((step) => step !== name))}
              >
                ✕
              </button>
            </li>
          ))}
          <li
            className="flow-step-row flow-step-row--dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(flowOrder.length)}
          >
            Drop here to add
          </li>
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add drag-and-drop styles**

In `packages/web/src/styles.css`, change:

```css
.alert {
```

to:

```css
.flow-builder {
  display: flex;
  gap: var(--space-lg);
  align-items: flex-start;
}

.flow-builder > .card {
  flex: 1;
}

.flow-step-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.flow-step-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-lg);
  padding: var(--space-sm) var(--space-md);
  font-size: 14px;
  cursor: grab;
  background: var(--color-canvas);
}

.flow-step-row--ordered {
  border-color: var(--color-ink);
}

.flow-step-index {
  background: var(--color-ink);
  color: var(--color-on-primary);
  border-radius: var(--radius-full);
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  flex-shrink: 0;
}

.flow-step-remove {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--color-mute);
  cursor: pointer;
  font-size: 14px;
  padding: 0;
}

.flow-step-row--dropzone {
  border: 1px dashed var(--color-hairline-strong);
  color: var(--color-mute);
  justify-content: center;
  cursor: default;
}

.alert {
```

(This inserts the new rules directly before the existing `.alert { ... }` rule — the rest of that rule and everything after it in the file is unchanged.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- FlowStepOrderEditor.test`
Expected: PASS (all 5 tests).

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/components/FlowStepOrderEditor.tsx packages/web/test/components/FlowStepOrderEditor.test.tsx packages/web/src/styles.css
git commit -m "feat(web): add FlowStepOrderEditor drag-and-drop component"
```

---

### Task 3: Rewire `FlowRunner`, `EndToEndTestPage`, and `App`

**Files:**
- Modify: `packages/web/src/components/FlowRunner.tsx`
- Modify: `packages/web/test/components/FlowRunner.test.tsx`
- Modify: `packages/web/src/components/EndToEndTestPage.tsx`
- Modify: `packages/web/src/App.tsx`

**Interfaces:**
- Consumes: `setFlow` (Task 1), `FlowStepOrderEditor` (Task 2).
- Produces: `FlowRunnerProps` gains `onFlowNamesChange: (flowNames: string[]) => void` and `stepNames: string[]`. `EndToEndTestPageProps` gains the same two.

- [ ] **Step 1: Write failing tests**

In `packages/web/test/components/FlowRunner.test.tsx`, change the import line:

```tsx
import { render, screen } from '@testing-library/react';
```

to:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
```

Change the `'disables Run Flow until a flow is selected'` test:

```tsx
  it('disables Run Flow until a flow is selected', () => {
    render(<FlowRunner flowNames={['Transfer money by wallet']} />);
    expect(screen.getByRole('button', { name: 'Run Flow' })).toBeDisabled();
  });
```

to:

```tsx
  it('disables Save Flow and Run Flow while Flow Order is empty', () => {
    render(
      <FlowRunner
        flowNames={['Transfer money by wallet']}
        onFlowNamesChange={vi.fn()}
        stepNames={['Check Balance']}
      />
    );
    expect(screen.getByRole('button', { name: 'Save Flow' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run Flow' })).toBeDisabled();
  });
```

In the `'runs a two-step flow and shows a passed checklist row per task'` test, change:

```tsx
    render(<FlowRunner flowNames={['Transfer money by wallet']} />);
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'Transfer money by wallet');
    await userEvent.click(screen.getByRole('button', { name: 'Run Flow' }));
```

to:

```tsx
    render(
      <FlowRunner
        flowNames={['Transfer money by wallet']}
        onFlowNamesChange={vi.fn()}
        stepNames={['Check Balance', 'Transfer Money']}
      />
    );
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'Transfer money by wallet');
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Run Flow' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Run Flow' }));
```

In the `'expands a task row to show its full response'` test, change:

```tsx
    render(<FlowRunner flowNames={['Balance Only']} />);
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'Balance Only');
    await userEvent.click(screen.getByRole('button', { name: 'Run Flow' }));
```

to:

```tsx
    render(
      <FlowRunner flowNames={['Balance Only']} onFlowNamesChange={vi.fn()} stepNames={['Check Balance']} />
    );
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'Balance Only');
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Run Flow' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Run Flow' }));
```

Then add this block at the end of the file, right before the final closing `});` of the `describe('FlowRunner', ...)` block:

```tsx

  it('populates Flow Order (and removes those steps from Available) when an existing flow is selected', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/flows/Transfer%20money%20by%20wallet') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(['Check Balance', 'Transfer Money']),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FlowRunner
        flowNames={['Transfer money by wallet']}
        onFlowNamesChange={vi.fn()}
        stepNames={['Check Balance', 'Transfer Money', 'Get User']}
      />
    );
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'Transfer money by wallet');

    await vi.waitFor(() => expect(screen.getByText('Check Balance')).toBeInTheDocument());
    expect(screen.getByText('Transfer Money')).toBeInTheDocument();
    expect(screen.getByText('Get User')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run Flow' })).toBeEnabled();
  });

  it('saves the current flow order via Save Flow and reports the updated flow names', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/flows/My%20New%20Flow' && init?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ names: ['My New Flow'] }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onFlowNamesChange = vi.fn();

    render(<FlowRunner flowNames={[]} onFlowNamesChange={onFlowNamesChange} stepNames={['Check Balance']} />);

    await userEvent.selectOptions(screen.getByLabelText('Flow'), '__new_flow__');
    await userEvent.type(screen.getByLabelText('New flow name'), 'My New Flow');

    fireEvent.dragStart(screen.getByText('Check Balance'));
    fireEvent.dragOver(screen.getByText('Drop here to add'));
    fireEvent.drop(screen.getByText('Drop here to add'));

    await userEvent.click(screen.getByRole('button', { name: 'Save Flow' }));

    expect(fetchMock).toHaveBeenCalledWith('/flows/My%20New%20Flow', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepNames: ['Check Balance'] }),
    });
    await vi.waitFor(() => expect(onFlowNamesChange).toHaveBeenCalledWith(['My New Flow']));
  });

  it('runs the current (possibly reordered) flow order, not the originally loaded order', async () => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);

    const stepA = sampleForm({ taskName: 'Check Balance', url: 'https://api.example.com/balance' });
    const stepB = sampleForm({ taskName: 'Transfer Money', url: 'https://api.example.com/transfer' });
    let capturedRunsBody = '';

    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
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
        capturedRunsBody = init?.body as string;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FlowRunner
        flowNames={['Transfer money by wallet']}
        onFlowNamesChange={vi.fn()}
        stepNames={['Check Balance', 'Transfer Money']}
      />
    );
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'Transfer money by wallet');
    await vi.waitFor(() => expect(screen.getByText('Transfer Money')).toBeInTheDocument());

    // Reorder: drag "Transfer Money" (loaded 2nd) to land before "Check Balance" (loaded 1st).
    fireEvent.dragStart(screen.getByText('Transfer Money'));
    fireEvent.dragOver(screen.getByText('Check Balance'));
    fireEvent.drop(screen.getByText('Check Balance'));

    await userEvent.click(screen.getByRole('button', { name: 'Run Flow' }));

    await vi.waitFor(() => expect(capturedRunsBody).not.toBe(''));
    const definition = JSON.parse(capturedRunsBody) as { tasks: { name: string }[] };
    expect(definition.tasks.map((t) => t.name)).toEqual(['Transfer Money', 'Check Balance']);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- FlowRunner.test`
Expected: FAIL — `FlowRunner` doesn't accept `onFlowNamesChange`/`stepNames` yet, and none of the new behavior exists.

- [ ] **Step 3: Rewrite `FlowRunner.tsx`**

Replace the entire contents of `packages/web/src/components/FlowRunner.tsx` with:

```tsx
import { useState } from 'react';
import type { RunEvent, StepResult } from '@ai-native-testing/engine';
import type { FormState } from '../types';
import { deriveResults, type DerivedResults } from '../results';
import { fetchFlow, setFlow } from '../flows';
import { fetchStep } from '../steps';
import { buildFlowDefinition } from '../dsl';
import { FlowResultsPanel, type TaskResult } from './FlowResultsPanel';
import { FlowStepOrderEditor } from './FlowStepOrderEditor';

export interface FlowRunnerProps {
  flowNames: string[];
  onFlowNamesChange: (flowNames: string[]) => void;
  stepNames: string[];
}

const NEW_FLOW_OPTION = '__new_flow__';

function taskStepCount(form: FormState): number {
  return 2 + form.extracts.length + form.questions.length;
}

export function FlowRunner({ flowNames, onFlowNamesChange, stepNames }: FlowRunnerProps) {
  const [selectedFlow, setSelectedFlow] = useState('');
  const [newFlowName, setNewFlowName] = useState('');
  const [flowOrder, setFlowOrder] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [taskResults, setTaskResults] = useState<TaskResult[] | null>(null);

  const availableSteps = stepNames.filter((name) => !flowOrder.includes(name));

  async function handleFlowChange(name: string) {
    setSelectedFlow(name);
    setNewFlowName('');
    setTaskResults(null);
    setError(null);
    if (name === '' || name === NEW_FLOW_OPTION) {
      setFlowOrder([]);
      return;
    }
    const steps = await fetchFlow(name);
    setFlowOrder(steps ?? []);
  }

  function resolvedFlowName(): string {
    return selectedFlow === NEW_FLOW_OPTION ? newFlowName.trim() : selectedFlow;
  }

  async function handleSave() {
    const flowName = resolvedFlowName();
    const names = await setFlow(flowName, flowOrder);
    if (names) {
      onFlowNamesChange(names);
      setSelectedFlow(flowName);
      setNewFlowName('');
    } else {
      setError('Could not save this flow. Please try again.');
    }
  }

  async function handleRun() {
    setError(null);
    setTaskResults(null);

    if (flowOrder.length === 0) {
      setError('This flow has no steps to run.');
      return;
    }

    const fetchedForms = await Promise.all(flowOrder.map((name) => fetchStep(name)));
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

  const canSave = flowOrder.length > 0 && resolvedFlowName() !== '';
  const canRun = flowOrder.length > 0;

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
        <select className="text-input" value={selectedFlow} onChange={(e) => handleFlowChange(e.target.value)}>
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
          <input className="text-input" value={newFlowName} onChange={(e) => setNewFlowName(e.target.value)} />
        </label>
      )}
      <FlowStepOrderEditor availableSteps={availableSteps} flowOrder={flowOrder} onFlowOrderChange={setFlowOrder} />
      <div className="row">
        <button type="button" className="btn-secondary" disabled={!canSave} onClick={handleSave}>
          Save Flow
        </button>
        <button type="button" className="btn-primary" disabled={!canRun} onClick={handleRun}>
          Run Flow
        </button>
      </div>
      <FlowResultsPanel taskResults={taskResults} />
    </section>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- FlowRunner.test`
Expected: PASS (all tests, including the 3 new ones).

- [ ] **Step 5: Thread `stepNames`/`onFlowNamesChange` through `EndToEndTestPage`**

Replace the entire contents of `packages/web/src/components/EndToEndTestPage.tsx` with:

```tsx
import { FlowRunner } from './FlowRunner';

export interface EndToEndTestPageProps {
  flowNames: string[];
  onFlowNamesChange: (flowNames: string[]) => void;
  stepNames: string[];
}

export function EndToEndTestPage({ flowNames, onFlowNamesChange, stepNames }: EndToEndTestPageProps) {
  return (
    <main className="app-main">
      <h1 className="heading-xl">End-to-end test</h1>
      <FlowRunner flowNames={flowNames} onFlowNamesChange={onFlowNamesChange} stepNames={stepNames} />
    </main>
  );
}
```

- [ ] **Step 6: Wire the new props into `App.tsx`**

In `packages/web/src/App.tsx`, change:

```tsx
          <Route path="/e2e-test" element={<EndToEndTestPage flowNames={flowNames} />} />
```

to:

```tsx
          <Route
            path="/e2e-test"
            element={
              <EndToEndTestPage
                flowNames={flowNames}
                onFlowNamesChange={setFlowNames}
                stepNames={stepNames}
              />
            }
          />
```

- [ ] **Step 7: Run the full web test suite**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests) — no other file references the old `FlowRunner`/`EndToEndTestPage` prop shapes.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/components/FlowRunner.tsx packages/web/test/components/FlowRunner.test.tsx packages/web/src/components/EndToEndTestPage.tsx packages/web/src/App.tsx
git commit -m "feat(web): rebuild the End-to-end test page around a drag-and-drop flow order editor"
```

---

### Task 4: Final verification

**Files:** none created or modified — this task only runs checks.

**Interfaces:** none.

- [ ] **Step 1: Run the full workspace test suite and typecheck**

Run: `pnpm test`
Expected: PASS across all 6 packages, no newly failing tests.

Run: `pnpm typecheck`
Expected: no errors in any package.

- [ ] **Step 2: Manual browser verification**

Start the backend (`pnpm --filter @ai-native-testing/server start`) and the GUI dev server (`pnpm --filter @ai-native-testing/web dev`). Using safe test data (not any real saved steps that would hit a real external endpoint), on the End-to-end test page confirm:

- Selecting "+ New Flow" shows an empty Flow Order and every saved step in All APIs; both Save Flow and Run Flow are disabled.
- Dragging a step from All APIs into Flow Order moves it there (removed from All APIs), and both buttons become enabled once Flow Order has at least one step.
- Dragging a Flow Order step to a new position reorders it; the numbered badges update to match.
- Clicking a Flow Order row's ✕ removes it and returns it to All APIs.
- Naming the new flow and clicking Save Flow persists it — reloading the page and selecting that flow by name shows the same steps in the same order.
- Reordering an already-saved flow and clicking Run Flow (without clicking Save Flow first) executes the new order, not the previously-saved one — confirmed by checking which task's results appear first in the per-task checklist.
- Switching the Flow picker away from an in-progress edit without saving discards it, and re-selecting the same flow reloads its last-saved order (not the discarded edit).

Take a screenshot as evidence, same as prior manual verifications in this project.

- [ ] **Step 3: Commit (if the manual check surfaced any fix)**

If Step 2 finds nothing to fix, there is nothing to commit for this task. If it does surface an issue, fix it, re-run Step 1, and commit:

```bash
git add -A
git commit -m "fix: correct issue found during manual E2E flow builder verification"
```
