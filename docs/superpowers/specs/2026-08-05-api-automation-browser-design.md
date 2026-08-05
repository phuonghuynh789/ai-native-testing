# API Automation Browser — Design Spec

## Goal

Add a third left-menu item, "API Automation," that lists every saved gRPC step and lets the user filter it down by E2E flow / Service / Method, then jump straight into Simple Mode with a chosen step loaded. This addresses a real, already-present need: the app's own saved steps already span three distinct gRPC services (`PaymentService`, `UserPayment`, `UserProfile`) across several steps, most of which aren't in any named flow yet.

## Scope

**In scope:**
- A new route `/api-automation` and `Sidebar` entry "API Automation," alongside the existing "Simple Mode" and "End-to-end test" items.
- A list of every saved step whose `protocol` is `'grpc'` — REST steps are excluded entirely from this page.
- Three free-text combobox filters (`<input list="...">` + `<datalist>`, matching the existing Actor/Task/Service/Method pattern already used elsewhere in the app): **Service**, **Method** (suggestions narrow to the selected Service, mirroring `RequestBuilder`'s existing behavior), and **E2E flow** (suggestions are every saved flow name, not narrowed by gRPC content). Each filter substring-matches (case-insensitive); empty means no constraint.
- Each matching row shows the step's name, Service, Method, and the flow(s) it belongs to (or "—" for none).
- Clicking a row loads that step into the shared `form` state and navigates to `/` (Simple Mode) — the same effect as picking it from the existing "Load Reusable Step" dropdown, just reached via search instead.
- No new backend routes — the page composes the existing `fetchStepNames`/`fetchStep`/`fetchFlowNames`/`fetchFlow` client functions, fetching every step's full content and every flow's step list on page load.

**Out of scope (deliberately deferred):**
- REST steps on this page (Service/Method are gRPC-only concepts today).
- Any new bulk/list-with-content backend endpoint — revisit only if the per-step/per-flow fetch count becomes a real performance problem at a much larger saved-step count than exists today.
- Any write actions from this page (editing, deleting, renaming a step) — it's a browse-and-jump-to-Simple-Mode tool only.
- Pagination or virtualization of the results list.

## Architecture & Data Flow

`ApiAutomationPage` (new) fetches, on mount: all step names (`fetchStepNames`) then each step's full `FormState` (`fetchStep`, one call per name), and all flow names (`fetchFlowNames`) then each flow's step list (`fetchFlow`, one call per name). From these it derives:
- The list of gRPC steps (`form.protocol === 'grpc'`), each paired with its computed flow membership (which flow name arrays include it).
- The distinct Service/Method/flow-name values used to populate the three `<datalist>`s.

It receives `stepNames`/`flowNames` as props from `App.tsx` (already-existing state — no new state added to `App.tsx` beyond wiring this one new route) and `onFormChange: Dispatch<SetStateAction<FormState>>` (the same setter `SimpleModePage` already receives). Filter state (`serviceFilter`, `methodFilter`, `flowFilter`) is local to `ApiAutomationPage`.

## Components

- **`ApiAutomationPage.tsx`** (new) — owns the fetch-on-mount logic, filter state, and renders the three combobox filters plus the filtered results list. Clicking a row calls `onFormChange(step)` then `navigate('/')` (via `react-router-dom`'s `useNavigate`).
- **`Sidebar.tsx`** (existing) — gains a third `NavLink` to `/api-automation`.
- **`App.tsx`** (existing) — gains one new `<Route path="/api-automation" element={<ApiAutomationPage ... />} />`, passing `stepNames`, `flowNames`, and `setForm`.

No existing component's behavior changes — `SimpleModePage`, `EndToEndTestPage`, `RequestBuilder`, `FlowRunner`, etc. are all untouched.

## Testing

- **`ApiAutomationPage.test.tsx`** (new): only gRPC steps appear (a REST step in the fixture data is confirmed absent); filtering by Service, by Method (with Method suggestions narrowing to the selected Service), and by E2E flow each correctly narrow the results; a step in multiple/zero flows shows the correct flow badges; clicking a row calls the `onFormChange` prop with that step's content.
- **`Sidebar.test.tsx`** (existing): new test for the third nav item's `href` and active state at `/api-automation`.
- **`App.test.tsx`** (existing): new integration test — navigate to API Automation, filter down to a known step, click it, and confirm Simple Mode shows that step's Task name, proving the full route-load-navigate round trip works end to end.
