# E2E Flow Drag-and-Drop Builder — Design Spec

## Goal

Replace the End-to-end test page's plain "pick an existing flow and run it" UI with a real flow builder: list every saved API (Reusable Step) and let the user drag-and-drop to set the execution order for an E2E flow, for both brand-new flows and editing an existing flow's order. "Run Flow" and "Save Flow" only enable once a valid order is in place.

This fills in one of the capabilities explicitly deferred from the original "Add to E2E Flow" increment: "editing/reordering/removing a flow's steps."

## Scope

**In scope:**
- The End-to-end test page's `Flow` picker gains "+ New Flow" (same inline name-input pattern `AddToFlowButton` already uses) alongside existing flow names.
- Selecting an existing flow (or "+ New Flow") populates two lists below the picker: **Available APIs** (every saved step not currently in this flow) and **Flow Order** (this flow's steps, in order).
- Drag-and-drop, native HTML5 (no new dependency): drag an Available item into Flow Order to add it; drag within Flow Order to reorder; click a Flow Order row's ✕ to remove it back to Available.
- Each saved step can appear at most once per flow — adding it removes it from Available; removing it returns it to Available.
- "Save Flow" persists the current Flow Order via a new `PUT /flows/:name` route (replaces the flow's entire step list — distinct from the existing `POST /flows`, which only appends one step and stays for `AddToFlowButton`'s quick-add use on Simple Mode).
- "Run Flow" executes the *current* Flow Order directly (no re-fetch from the server first), so a just-reordered-but-unsaved arrangement runs exactly as arranged.
- Both "Save Flow" and "Run Flow" are disabled while Flow Order is empty (and Save Flow is also disabled while a new flow's name field is blank) — same gating pattern already used for Run/Save on Simple Mode.
- Switching the Flow picker away from an in-progress edit silently discards it — no "unsaved changes" confirmation, consistent with every other selection switch in this app today.

**Out of scope (deliberately deferred):**
- Deleting a flow entirely.
- Any drag-and-drop library (`@dnd-kit`, etc.) — native HTML5 DnD only.
- Touch/mobile drag support — this is a desktop-only internal tool, consistent with prior increments.
- Repeating the same step more than once within one flow.
- A confirmation prompt before discarding unsaved reordering.

## Architecture & Data Model

`FlowStore` (`packages/server/src/flow-store.ts`) gains `setSteps(flowName: string, stepNames: string[]): Promise<void>` — replaces a flow's entire step array (creating the flow if it doesn't exist yet), distinct from the existing `addStep` (which only appends one name and remains used by `AddToFlowButton`). A new route, `PUT /flows/:name` with body `{ stepNames: string[] }`, backs this. A new client function `setFlow(name, stepNames)` in `packages/web/src/flows.ts` calls it, alongside the existing `fetchFlowNames`/`fetchFlow`/`addStepToFlow`.

`FlowRunner.tsx` gains a new `stepNames: string[]` prop (threaded down from `App.tsx` → `EndToEndTestPage`, mirroring how Simple Mode already receives it) and new local state `flowOrder: string[]`. `availableSteps` is never separately stored — it's always computed as `stepNames.filter(name => !flowOrder.includes(name))`, so the two lists can't drift out of sync. Selecting an existing flow loads its steps into `flowOrder`; picking "+ New Flow" starts it empty. `handleRun` changes from re-fetching the flow's steps from the server to using `flowOrder` directly, so Run Flow always executes exactly what's currently arranged.

## Components

- **`FlowStepOrderEditor.tsx`** (new, presentational): the two-column drag-and-drop UI. Props: `availableSteps: string[]`, `flowOrder: string[]`, `onFlowOrderChange: (next: string[]) => void`. All three interactions — dragging an Available item into Flow Order, reordering within Flow Order, clicking ✕ to remove — each compute the resulting full array and call `onFlowOrderChange` once; the parent (`FlowRunner`) just does `setFlowOrder(next)`. Basic drag-over visual feedback (highlighting the row/position a dragged item would land on).
- **`FlowRunner.tsx`** (existing, modified): owns the Flow picker (including the "+ New Flow" name input, mirroring `AddToFlowButton`'s existing pattern), renders `FlowStepOrderEditor`, "Save Flow", "Run Flow", and the existing `FlowResultsPanel`. Keeps its existing run/SSE-streaming logic, now driven by `flowOrder` instead of a server re-fetch.
- **`AddToFlowButton`** stays exactly as it is — a quick one-off "append this step to a flow" shortcut on Simple Mode, separate from the full builder on the End-to-end test page.

## Testing

- `flow-store.test.ts`: new tests for `setSteps` — replaces an existing flow's steps, and creates a new flow entry if the name doesn't exist yet.
- `flows-routes.test.ts`: new tests for `PUT /flows/:name` (200 + persists; 400 on missing/empty body).
- `flows.ts` client test: new test for `setFlow`.
- `FlowStepOrderEditor.test.tsx` (new): renders steps in the correct column; each of the three drag/remove interactions calls `onFlowOrderChange` with the correctly-computed array. jsdom's HTML5 drag-event support is historically incomplete, so these tests likely need `fireEvent.dragStart(el, { dataTransfer: {...} })`-style synthetic events rather than `userEvent`'s higher-level helpers — the exact working pattern will be verified directly against this project's jsdom version during implementation, not assumed.
- `FlowRunner.test.tsx` (existing): updated for the new `stepNames` prop; new tests for loading an existing flow's steps into Flow Order, Save Flow calling the new endpoint, and Run Flow executing the current (possibly just-reordered) `flowOrder` rather than a re-fetched one.
