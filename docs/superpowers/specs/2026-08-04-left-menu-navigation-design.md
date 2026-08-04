# Left Menu Navigation (Simple Mode / End-to-end test) — Design Spec

## Goal

Split the app's current single scrolling page into two navigable views — "Simple Mode" and "End-to-end test" — behind a persistent left sidebar menu, replacing today's single hardcoded title ("API Runner — REST (Simple Mode)") and single-page layout where both the request builder and the flow runner live on the same scroll.

## Scope

**In scope:**
- A persistent left sidebar with a small "API Runner" label and two nav items: "Simple Mode" (path `/`) and "End-to-end test" (path `/e2e-test`).
- `react-router-dom` as a new runtime dependency (the app's second, after `react`/`react-dom`) — no real competing choice for client-side routing in a Vite+React app.
- Splitting today's single `App.tsx` JSX into two page components: `SimpleModePage` (Actor/Task header, Load Reusable Step, Variables, Request Builder, Run, Save as Reusable Step, Add to E2E Flow, single-request Results panel) and `EndToEndTestPage` (the Flow picker, Run Flow button, per-task flow results — today's "E2E Flows" section).
- All existing state and logic stays in `App.tsx` exactly as it is today (`useState`, `useEffect` fetches, `handleRunStart`, `isFormValid`, etc.) — the two page components are purely presentational, receiving everything via props. This means in-progress Simple Mode form state is preserved when navigating to End-to-end test and back, since nothing about the state's ownership changes, only which JSX subtree is mounted.
- Visiting the bare app URL (`/`) renders Simple Mode directly, matching today's behavior exactly — no redirect.
- Minimal, docs-nav-style sidebar visual design: light background, left-border active-item indicator, reusing existing design tokens (`--color-surface-soft`, `--color-hairline`, `--color-ink`, `--color-body`) — no new colors.

**Out of scope (deliberately deferred):**
- Any responsive/mobile collapse behavior for the sidebar (e.g. hamburger menu) — the app has no existing responsive breakpoints to begin with, and this is an internal QA tool used on desktop.
- Any third+ menu item, nested routes, or route-level code-splitting — exactly two flat routes.
- Persisting the active route across a full page reload via anything beyond the URL itself (the URL already does this for free with a router).
- Changing `RequestBuilder`, `FlowRunner`, or any other existing component's props or behavior — only their container (`App.tsx`'s JSX) changes.

## Architecture & Routing

`App.tsx` wraps its existing return value in a `<BrowserRouter>`, rendering a persistent `<Sidebar>` alongside a `<Routes>` block with two routes:

```
/          → <SimpleModePage {...props} />
/e2e-test  → <EndToEndTestPage {...props} />
```

`App.tsx` itself keeps every piece of state, every `useEffect` fetch, and every handler function completely unchanged — only its `return` statement changes, from one flat JSX tree to a router shell that conditionally mounts one of the two new page components, passing down the same props it already computes today.

## Components

- **`Sidebar`** (`packages/web/src/components/Sidebar.tsx`) — new. Renders a small "API Runner" label and two `react-router-dom` `NavLink`s ("Simple Mode" → `/`, "End-to-end test" → `/e2e-test`). `NavLink` provides the active-route match automatically (via its `className` render-prop or the `aria-current` attribute it sets), so the component has no manual "which page am I on" logic of its own.
- **`SimpleModePage`** (`packages/web/src/components/SimpleModePage.tsx`) — new. A pure prop-forwarding wrapper around the JSX block `App.tsx` renders today for: `<h1>Simple Mode</h1>`, `ScreenplayHeader`, `LoadStepSelect`, the Variables `KeyValueRows`, `RequestBuilder`, `RunButton`, `SaveStepButton`, `AddToFlowButton`, `ResultsPanel`.
- **`EndToEndTestPage`** (`packages/web/src/components/EndToEndTestPage.tsx`) — new. A pure prop-forwarding wrapper around `<h1>End-to-end test</h1>` plus the existing `FlowRunner`.

No existing component (`RequestBuilder`, `FlowRunner`, `RunButton`, etc.) changes at all — only `App.tsx`'s top-level JSX is restructured into these three new files.

## Styling

New CSS in `packages/web/src/styles.css`, reusing existing tokens only:

- `.app-shell` — new top-level flex row wrapping the sidebar and the content area. Replaces `<main className="app-main">` as the document's outermost element.
- `.sidebar` — fixed 180px width, full viewport height, background `var(--color-surface-soft)`, right border `1px solid var(--color-hairline)`.
- `.sidebar-label` — the small "API Runner" text above the nav items.
- `.sidebar-link` — each nav item: `padding`, `font-weight: 500`, color `var(--color-body)`, `border-left: 3px solid transparent`.
- `.sidebar-link--active` (or equivalent, applied via `NavLink`'s active state) — `border-left-color: var(--color-ink)`, `color: var(--color-ink)`, `font-weight: 600`.

`.app-main`'s existing rules (`max-width: 720px`, centered, internal spacing) are unchanged — it becomes the content column inside `.app-shell`, sitting next to `.sidebar`, so nothing about the Request Builder's or Flow Runner's internal layout needs to change.

## Testing

- **`Sidebar.test.tsx`** (new): rendered inside a `MemoryRouter` at each of the two paths, asserts the correct nav item carries the active styling/attribute at that route, and that both items have the correct `href`.
- **`App.test.tsx`** (existing): unaffected — jsdom's default test URL is `/`, matching the Simple Mode route, so every existing test (which interacts with the Simple Mode form directly) keeps passing with no changes.
- **New `App.test.tsx` cases**: clicking "End-to-end test" shows the Flow picker and hides the Request Builder (and clicking back to "Simple Mode" reverses that); filling in the Task name field, navigating to End-to-end test and back, and confirming the Task name value survived the round trip (proving state is preserved across navigation, not reset).
- `SimpleModePage`/`EndToEndTestPage` get no dedicated unit tests of their own — they carry zero logic, so the `App.test.tsx` integration tests above are the correct level of coverage; separate unit tests for pure pass-through JSX would be redundant.
