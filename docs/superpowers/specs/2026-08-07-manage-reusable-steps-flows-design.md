# Manage Reusable Steps & Flows — Design

## Overview

A new left-menu page, "Manage Load Reusable Step," positioned right after "Simple Mode." It lets the user search, page through, and delete saved Reusable Steps and saved E2E Flows — the first delete capability and the first pagination anywhere in the app. Today, saved steps/flows can only grow; there's no way to remove ones that are no longer needed, and `LoadStepSelect`'s dropdown (and the equivalent Flow picker) just keeps accumulating entries.

Out of scope, deliberately: the PRD's aspirational folder/tree hierarchy for a "Step Repository" (`docs/PRD_APIRunner.md`) — the current `StepStore`/`FlowStore` are flat name-keyed JSON maps with no concept of folders or tags, and building against that flat shape is the consistent choice for this increment. Also out of scope: editing a step/flow's contents from this page (use the existing Load-into-Simple-Mode / E2E Flow builder flows for that), bulk delete, and soft-delete/undo.

## Architecture & Data Flow

- **Route**: `/manage-steps`, rendered by a new `ManageStepsPage` component. **Sidebar**: new entry "Manage Load Reusable Step" inserted immediately after "Simple Mode" in `Sidebar.tsx`.
- The page has two tabs, **Steps** and **Flows**, each independently searchable and paginated (20 rows/page, server-side). Switching tabs does not share search state.
- **Backend**: both `StepStore` and `FlowStore` gain a `delete` method and a `search` method (paginated, substring name match). Two new routes per resource (`GET .../search`, `DELETE .../:name`) are added **alongside**, not replacing, the existing `GET /steps` / `GET /flows` endpoints — those existing endpoints return a bare array of names and are depended on by `fetchStepNames()`/`fetchFlowNames()` in `LoadStepSelect`, `ApiAutomationPage`, and `FlowRunner`. Changing their shape would ripple into all three; new endpoints avoid that entirely.
- **Frontend**: new `searchSteps`/`deleteStep` functions in `packages/web/src/steps.ts`, new `searchFlows`/`deleteFlow` functions in `packages/web/src/flows.ts`. `ManageStepsPage` needs `stepNames`/`onStepNamesChange` and `flowNames`/`onFlowNamesChange` from `App.tsx` (same props already threaded to other pages) so a deletion here is immediately reflected in `LoadStepSelect`'s dropdown and `ApiAutomationPage`'s browser without a page reload.
- **Flow-reference check** (Steps tab only): before confirming a step delete, the client fetches all flow names and each flow's step list (reusing the existing `fetchFlowNames`/`fetchFlow` functions — the same cross-reference logic `ApiAutomationPage` already performs) and checks whether the step being deleted appears in any of them.

## Steps Tab

- Search textbox labeled "Reusable Step" + "Search" button. On page load, fetches page 1 with an empty search term (shows all steps, matching "default display all").
- Table columns: **Reusable Step** (name) · **HTTP Verb** · **URL** · **Protocol** · **Service** · **Method** · **[Delete icon]**.
  - REST steps: HTTP Verb = `form.method`, URL = `form.url`; Service/Method show `—`.
  - gRPC steps: Service = `form.grpc.service`, Method = `form.grpc.method`; HTTP Verb/URL show `—`.
  - Protocol always shows (`rest` | `grpc`).
- Pagination: 20 rows/page, Prev/Next buttons + "Page X of Y" indicator. No jump-to-page-number control (YAGNI at current scale).
- Search matches only the step name (the "Reusable Step" column), case-insensitive substring — not a multi-field filter across Protocol/Service/Method/URL.
- Delete: click the Delete icon → client checks flow references →
  - Not referenced by any flow: plain `Delete '<name>'?` confirm.
  - Referenced by one or more flows: `Used by flows: A, B. Delete anyway?` confirm.
  - On confirm: `DELETE /steps/:name`, then re-run the current search/page, then update the shared `stepNames` list.

## Flows Tab

- Search textbox labeled "E2E flow" + "Search" button, same 20/page server-side pagination as Steps.
- Table columns: **Flow Name** · **Steps** (full list of step names, comma-separated) · **[Delete icon]**.
- Delete: no reference check needed — nothing in the data model references a flow by name. Plain `Delete '<name>'?` confirm → `DELETE /flows/:name` → re-run current search/page → update shared `flowNames`.

## Backend Data Contracts

**Steps:**
- `StepStore.delete(name: string): Promise<boolean>` — removes the entry if present, persists, returns whether it existed.
- `StepStore.search(query: string, page: number, pageSize: number): Promise<{ items: StepSummary[]; total: number }>` where `StepSummary = { name: string; protocol: 'rest' | 'grpc'; method: string; url: string; grpcService: string; grpcMethod: string }` (empty string for the fields that don't apply to a given protocol). Case-insensitive substring match on `name`; `total` is the full match count before pagination.
- `GET /steps/search?search=<term>&page=<n>&pageSize=<n>` → `{ items: StepSummary[], total: number }`.
- `DELETE /steps/:name` → `{ names: string[] }` (updated full name list, matching `POST /steps`'s response shape), 404 if the name doesn't exist.

**Flows:**
- `FlowStore.delete(name: string): Promise<boolean>` — same semantics as `StepStore.delete`.
- `FlowStore.search(query: string, page: number, pageSize: number): Promise<{ items: FlowSummary[]; total: number }>` where `FlowSummary = { name: string; steps: string[] }`.
- `GET /flows/search?search=<term>&page=<n>&pageSize=<n>` → `{ items: FlowSummary[], total: number }`.
- `DELETE /flows/:name` → `{ names: string[] }`, 404 if the name doesn't exist.

## Error Handling

- Empty search results: "No reusable steps found" / "No flows found" — an empty state, not an error.
- Delete returns 404 (e.g. already deleted in another browser tab): show an inline error message, then automatically refresh the current tab's search/page.
- Search request failure (network error, non-2xx): show an inline error message; keep whatever results were already on screen rather than clearing to blank.
- Deleting the last remaining row on a page beyond page 1 leaves that page empty on the immediate re-fetch — step back one page automatically in that case (re-run the search at `page - 1`) rather than showing an empty table with "Prev" as the only way out.

## Testing

- **Backend**: `step-store.test.ts` and `flow-store.test.ts` gain `delete`/`search` cases (substring matching, pagination boundaries, deleting a nonexistent name). `steps-routes.test.ts` and `flows-routes.test.ts` gain cases for the new search and DELETE routes (including 404s).
- **Frontend**: new `ManageStepsPage.test.tsx` covering both tabs — search, pagination, delete with and without flow references (Steps tab), delete on Flows tab, empty states. A small wiring test confirms the new Sidebar entry and route render the page.
- **Manual verification**: create disposable test steps/flows specifically to exercise delete (never touch real saved production data, per this project's established convention) — confirm a deleted row disappears from the table *and* from `LoadStepSelect`'s dropdown / the Flow picker elsewhere in the app without a page reload.
