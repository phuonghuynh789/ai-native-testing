# Add to E2E Flow — Design Spec

## Goal

Add an "Add to E2E Flow" button (right after "Save as Reusable Step") that appends a saved Reusable Step to a named flow, plus a "Run E2E Flow" section that executes a saved flow's steps as one multi-task test run — chaining variables extracted by earlier steps into later ones, the way a real multi-API business flow (e.g. "Transfer money by wallet": check balance → transfer → confirm) needs to work.

This builds directly on the existing "Save as Reusable Step" increment and the engine's already-proven multi-task execution (`Login → Create Payment → Get Payment Status`, sharing one `RunContext` across tasks).

## Scope

**In scope:**
- An "Add to E2E Flow" button that opens a small inline panel to pick a saved Step and a Flow (existing or new), appending the step to that flow's ordered list.
- A "Run E2E Flow" section: pick a saved flow, run it as a single multi-task `TestDefinition`, see a per-task pass/fail checklist with expandable full-response detail per task.
- File-backed flow persistence (ordered list of step names, mirroring the existing Actor/Task/Step persistence patterns).

**Out of scope (deliberately deferred):**
- The PRD's full drag-and-drop Flow Builder canvas, and non-REST node types (Delay, Condition, Loop, Database, Kafka, Redis).
- Editing a flow's step order, removing a step from a flow, or deleting a flow.
- Any UI for reordering steps within a flow beyond "append in the order added."
- Per-task actor overrides — a flow uses exactly one Actor for its entire run (see below).

## Architecture

### Data model & persistence

A flow stores an **ordered list of step names** — a live reference, matching how `LoadStepSelect` already treats saved steps. Mirrors the existing `NameListStore`/`StepStore` file-backed pattern:

- **`packages/server/src/flow-store.ts`** — `FlowStore`:
  ```ts
  export class FlowStore {
    constructor(filePath: string);
    list(): Promise<string[]>;
    get(name: string): Promise<string[] | undefined>;
    addStep(flowName: string, stepName: string): Promise<string[]>; // returns updated flow names, creates the flow if new
  }
  ```
- **`packages/server/src/routes/flows.ts`**:
  - `GET /flows` → `string[]` of flow names.
  - `GET /flows/:name` → that flow's ordered step names (`string[]`), or `404` if not found.
  - `POST /flows` with body `{ flowName: string, stepName: string }` → appends `stepName` to `flowName` (creating the flow if new), returns `201 { names: string[] }` (updated flow names). `400` if either field is blank.
  - Wired into `buildApp` alongside `actorStore`/`taskStore`/`stepStore`, storing at `packages/server/data/flows.json`, e.g. `{ "Transfer money by wallet": ["Check Balance", "Transfer Money", "Confirm Transfer"] }`.

No new backend "run a flow" endpoint — running a flow is composed entirely on the frontend and submitted through the existing `POST /runs`.

### Composing a flow into a `TestDefinition`

Requires a small refactor of `packages/web/src/dsl.ts`: extract the per-task step-building logic currently inline in `buildTestDefinition` into a shared helper:

```ts
export function buildTaskSteps(form: FormState): Step[]; // [interaction, raw-extract, ...extracts, ...questions]
```

`buildTestDefinition` (existing, single-request path) calls this unchanged internally. A new function composes a whole flow:

```ts
export function buildFlowDefinition(forms: FormState[]): TestDefinition;
```

- **Actor**: `forms[0].actorName` — the actor of the first step added to the flow (with `abilities: ['rest']`). No separate actor prompt for the flow itself.
- **Variables**: each form's own `variables` rows are merged in order; later forms' values override earlier ones for duplicate keys. Since steps in one flow typically carry the same `baseUrl`-style seed values, this just needs to not break on minor differences — last-one-wins is a safe default.
- **Tasks**: one `TaskDefinition` per form, in flow order: `{ name: form.taskName, steps: buildTaskSteps(form) }`.

Because each task's steps still use `${var}` interpolation exactly like a single request does, and the engine already shares one `RunContext` across all tasks in a run, a value extracted in an earlier task (e.g. an auth token from a login step) is automatically available to a later task's `${accessToken}` — no engine changes needed; this is already proven by the existing `rest-flow.test.ts` end-to-end test.

### Add-to-Flow UI

- **`packages/web/src/flows.ts`** — fetch wrappers mirroring `steps.ts`:
  ```ts
  export function fetchFlowNames(): Promise<string[]>;
  export function fetchFlow(name: string): Promise<string[] | undefined>;
  export function addStepToFlow(flowName: string, stepName: string): Promise<string[] | undefined>;
  ```
- **`packages/web/src/components/AddToFlowButton.tsx`** — self-contained, positioned right after `SaveStepButton` in `App.tsx`:
  ```ts
  export interface AddToFlowButtonProps {
    stepNames: string[];
    flowNames: string[];
    onAdded: (flowNames: string[]) => void;
  }
  ```
  Clicking "Add to E2E Flow" toggles open an inline panel (not a native dialog, since it needs two related selections):
  - **Step** — a `<select>` of all saved Reusable Step names.
  - **Flow** — a `<select>` of existing flow names plus a `"+ New Flow"` option; choosing it reveals a text input for the new flow's name.
  - An "Add" button, disabled until a Step is chosen and a Flow is resolved (existing selection, or a non-empty new name). Confirms via `addStepToFlow`, then calls `onAdded(updatedFlowNames)` and closes the panel. A "Cancel" control closes without adding.

`App.tsx` gains `flowNames` state, fetched on mount alongside `stepNames`, passed to this component and the flow runner below.

### Run E2E Flow UI + per-task results

- **`packages/web/src/components/FlowRunner.tsx`** — a new, independent section (its own card, placed below the existing single-request `ResultsPanel` — running a flow is a distinct mode from building one request):
  ```ts
  export interface FlowRunnerProps {
    flowNames: string[];
  }
  ```
  Otherwise fully self-contained: its own `<select>` to pick a flow, its own "Run Flow" button, own SSE handling and results state — following the same independent-component pattern as `RunButton`.
  - On Run: `fetchFlow(name)` → ordered step names → `fetchStep` each → `buildFlowDefinition(forms)` → `POST /runs` → open an `EventSource` exactly like `RunButton`, collecting the same flat `stepResults` array shape the engine already emits.
  - **Per-task grouping**: each task's leaf-step count is deterministic (`2 + form.extracts.length + form.questions.length`), so `FlowRunner` computes cumulative boundaries per task and slices the flat `stepResults` into per-task segments, calling the existing `deriveResults(form.extracts, variables, taskSlice)` for each — no changes to `results.ts`.
- **`packages/web/src/components/FlowResultsPanel.tsx`** — one row per task: name, pass/fail/pending status, final HTTP status code if available. Clicking a row expands it to show that task's full response, reusing the existing `<ResultsPanel results={taskResults} />` unchanged.

## Testing Plan

- **`packages/server/test/flow-store.test.ts`** — empty list initially; `addStep` creates a new flow with one step; `addStep` appends to an existing flow with order preserved; persists across separate `FlowStore` instances; creates a nested data directory if needed.
- **`packages/server/test/flows-routes.test.ts`** — `GET /flows` empty initially; `POST /flows` creates/appends and returns updated flow names; `400` for blank `flowName`/`stepName`; `GET /flows/:name` returns the ordered step list; `404` for an unknown flow.
- **`packages/web/test/dsl.test.ts`** (extended) — `buildTaskSteps` produces the same shape `buildTestDefinition` already tests; `buildFlowDefinition` with 2-3 sample forms produces the right `actor` (from the first form), merged `variables` (later overrides earlier on key conflict), and one `TaskDefinition` per form in order.
- **`packages/web/test/flows.test.ts`** — `fetchFlowNames`/`fetchFlow`/`addStepToFlow` success and failure paths, mirroring `steps.test.ts`.
- **`packages/web/test/components/AddToFlowButton.test.tsx`** — Add disabled until step and flow are both resolved; adding to an existing flow; creating a new flow via `"+ New Flow"`; Cancel closes without calling `addStepToFlow`.
- **`packages/web/test/components/FlowRunner.test.tsx`** — selecting and running a flow submits the composed multi-task `TestDefinition` to `/runs`; per-task checklist rows update to passed/failed as SSE events arrive; expanding a row shows that task's full response (reusing `ResultsPanel`).
- **`packages/web/test/App.test.tsx`** (extended) — add a `/flows` stub to the existing fetch-mocking helper so current tests keep passing.

No new engine-level end-to-end test is needed — the exact chaining behavior a flow relies on (values extracted by one task available to a later task via `${var}`) is already proven by the existing `packages/server/test/rest-flow.test.ts`. This plan only adds a GUI/persistence layer on top of engine capability that already works.
