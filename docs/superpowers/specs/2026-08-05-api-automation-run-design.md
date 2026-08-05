# API Automation "Run" — Design Spec

## Goal

Add a "Run" button to the API Automation page that executes every currently filtered/visible gRPC step and shows a Passed/Failed status per step, with per-step response detail available on click — turning the page from a browse-and-jump-to-Simple-Mode tool into a batch smoke-test tool as well.

## Scope

**In scope:**
- A "Run" button next to the filters, disabled when the filtered list is empty or a run is already in progress.
- Runs only the steps currently visible under the active Service/Method/E2E flow filters — not every saved gRPC step.
- Each step executes as its own independent request (its own `TestDefinition`, its own `/runs` job, its own `EventSource`) rather than being chained into one combined flow. This is a deliberate consequence of the engine's dispatcher being fail-fast (`packages/engine/src/dispatcher.ts`'s `executeSteps` returns immediately on the first failed/thrown step) — chaining these steps into one flow the way `FlowRunner` does would mean one failing step silently prevents every later step from running at all, defeating the point of "run all these and see which pass."
- All steps run concurrently (fired at once, not queued one-by-one).
- Results render as a **separate list below** the existing filterable row list, reusing the existing `FlowResultsPanel` component verbatim: each entry shows the step name and Passed/Failed (plus response status code, matching `FlowResultsPanel`'s existing display), and is clickable to expand/collapse that step's full response detail (reusing `ResultsPanel`, exactly as `FlowRunner`'s results already work).
- Changing any filter clears the current results list (a stale status for a since-filtered-out row, or a newly-visible row with no result yet, would be confusing) — Run must be clicked again after refiltering.
- The existing filterable row list above is **unchanged**: clicking a row still always loads that step into Simple Mode, regardless of whether a Run has happened.

**Out of scope (deliberately deferred):**
- Any new backend endpoint — reuses the existing `POST /runs` / `GET /runs/:jobId/events` exactly as the single-step Simple Mode "Run" button and `FlowRunner` already do.
- Cancelling an in-progress batch run.
- Any chaining/shared-variable behavior between the run steps (they are independent, unrelated saved steps that happen to match a filter — not a designed sequence).
- Sequential/throttled execution — always concurrent for this slice.
- Persisting or exporting run history.

## Architecture & Data Flow

`ApiAutomationPage` gains `taskResults: TaskResult[] | null` state (the `TaskResult` type already exported by `FlowResultsPanel.tsx` — `{ name: string; status: 'pending' | 'passed' | 'failed'; results: DerivedResults }`).

Clicking Run, for the current `filteredEntries`:
1. Clears any previous `taskResults`.
2. For each entry, calls `buildTestDefinition(entry.form)` (the same function the existing single "Run" button in `RunButton.tsx` already uses to build a one-task `TestDefinition`) and `POST`s it to `/runs`, independently per entry.
3. Opens one `EventSource` per job on `/runs/:jobId/events`.
4. As each job's `step:completed`/`step:failed` events arrive, accumulates that job's `StepResult[]` and recomputes its `DerivedResults` via the existing `deriveResults(entry.form.extracts, variablesRecord, stepResults)` — identical math to `FlowRunner.recomputeTaskResults`, but with no step-index offset needed since each job's event indices already start at 0 for that job alone (there is exactly one task per job, unlike `FlowRunner`'s combined multi-task job).
5. Overall per-step status is computed with the same rule `FlowRunner` already uses: once the job's `StepResult[]` has as many completed entries as `buildTaskSteps(entry.form).length` (the already-exported `dsl.ts` helper — reused directly instead of re-deriving the `2 + extracts.length + questions.length` arithmetic that `FlowRunner.tsx`'s private, unexported `taskStepCount` currently hard-codes), status is `passed` if every result passed, otherwise `failed`; while incomplete, `failed` as soon as any received result has failed, otherwise `pending`.
6. `taskResults` is updated incrementally as each job's events arrive (not all-at-once at the end), matching `FlowRunner`'s existing streaming-update behavior.

Any filter's `onChange` handler additionally clears `taskResults` to `null`.

## Components

- **`ApiAutomationPage.tsx`** (modify): adds the state above, a `handleRun` function mirroring `FlowRunner.handleRun`'s per-job logic but firing one job per filtered entry instead of one combined flow, a "Run" button, and renders `<FlowResultsPanel taskResults={taskResults} />` below the existing row list.
- **`FlowResultsPanel.tsx`**: unchanged, reused as-is for the results list and per-row expand/collapse detail.
- **`ResultsPanel.tsx`**, **`buildTestDefinition`**, **`deriveResults`**, `/runs` and `/runs/:jobId/events`: unchanged, reused as-is.
- The existing filterable row list in `ApiAutomationPage.tsx` (name/Service-Method/flow-membership, click-to-load) is untouched.

## Testing

- `ApiAutomationPage.test.tsx` (extend):
  - Clicking Run with N filtered gRPC steps starts N independent `POST /runs` calls (not one combined multi-task flow) and N separate `EventSource` connections.
  - Each step's Passed/Failed status renders correctly and independently of the others — including the case where one step's run fails and a later, independent step still completes and shows its own correct (passing) status, proving they are not chained by the fail-fast dispatcher.
  - Clicking a result row in the results list expands/collapses its response detail.
  - Changing any filter after a Run clears the results list.
  - Run is disabled when the filtered list is empty, and while a run is already in progress.
  - The existing filterable row list's click-to-load-into-Simple-Mode behavior is unaffected by a completed Run.
- No changes needed to `FlowResultsPanel.test.tsx`, `FlowRunner.test.tsx`, or any backend test — nothing there changes.
