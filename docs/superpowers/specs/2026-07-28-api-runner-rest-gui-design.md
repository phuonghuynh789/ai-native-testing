# API Runner: REST GUI — Simple Mode — Design

## Context

This is a follow-up sub-project to the already-merged [API Runner (REST,
Simple Mode)](2026-07-27-api-runner-design.md), which built the backend
execution engine for REST testing (`packages/runner-api`'s `RestRunner`,
plus the `TestDefinition.variables` and `extract` additions to
`packages/engine`) but was explicitly backend-only — "No GUI" was in that
spec's scope, deferred to a later increment.

The full PRD's API Runner section describes a much larger GUI surface:
Simple Mode *and* Advanced Mode, REST *and* gRPC *and* GraphQL GUIs, plus
Project/Save/Environment management. Consistent with how every other
sub-project in this project has been scoped (Core, then API Runner itself),
this spec narrows to exactly what was requested: **the REST GUI's Simple
Mode, single-API-test screen** — the actual mockup in PRD section 1.2. No
gRPC or GraphQL GUI, no Advanced Mode, no multi-task E2E flow builder, and no
persistence (no Project/Save/named Environment) — all deferred to later
increments once this walking skeleton is proven.

This is also the first frontend/UI code in the platform; no frontend package
exists yet.

## Goal

A React + TypeScript single-page GUI that lets a user build one REST API
test (one Actor, one Task, one HTTP request, any number of extract/assertion
steps against its response), run it against the already-existing backend
(`POST /runs` on `packages/server`), and watch results arrive live — without
needing to write the JSON `TestDefinition` DSL by hand.

## Scope

**In scope:**

- A new `packages/web` pnpm workspace package: React + Vite + TypeScript.
- Building and running exactly **one** REST API test (one Actor, one Task,
  one `request` interaction, any number of `extract`/`question` steps
  against that single response).
- A key/value **Variables** editor seeding `TestDefinition.variables`
  (`baseUrl`, credentials, etc.) — the closest equivalent to the PRD's
  "Environment," with no persistence.
- Request builder: Method, URL, Params, Headers, Auth (Bearer/API
  key/Basic), Body.
- Extract and Questions editors (row lists), each row driving one `extract`
  or `question` step.
- Running via the existing SSE endpoint (`GET /runs/:jobId/events`) for live,
  step-by-step results — not polling.
- A results view: Response, Saved Values, Context, Logs.

**Out of scope, deferred to later increments:**

- gRPC and GraphQL GUIs.
- Advanced Mode (reusable Actors/Abilities/Tasks, Conditions, Loops,
  Parallel, Retry, Polling, Hooks, Data-driven, Test Suites, Code
  generation, CI/CD) — consistent with the backend not supporting any of
  this yet either.
- A multi-task **E2E flow** builder (ordering/chaining multiple REST calls
  visually). This screen builds and runs a single task only; the backend
  already supports multi-task flows (proven by the API Runner sub-project's
  own end-to-end test), but a flow-builder UI (step ordering, cross-task
  variable visualization) is a meaningfully bigger UI surface than a single
  request form and becomes its own natural follow-up.
- Any persistence: Project management, "Save"/"Load" of a test definition,
  named Environments. The backend has no database and no concept of a saved
  test; refreshing the page loses the current form's contents.
- Automated browser-driven end-to-end tests (e.g. Playwright) — manual
  verification only for this increment.

## Architecture

```
Browser (React app, Vite dev server, e.g. :5173)
   │  Vite dev proxy: /runs* → http://localhost:3000
   ▼
Fastify server (packages/server, unchanged) — :3000
   │  POST /runs, GET /runs/:jobId, GET /runs/:jobId/events (SSE)
   ▼
Task Dispatcher → RestRunner (unchanged, both from the prior sub-project)
```

No backend changes. The Vite dev server proxies API requests to the
existing Fastify server so the browser never needs CORS handling; this is a
dev-only concern (a production build's serving strategy is out of scope for
this increment, matching the backend having no deployment story yet either).

**Live results via SSE, not polling:** the backend's
`GET /runs/:jobId/events` already replays history and then streams live
`step:started` / `step:completed` / `step:failed` / `run:completed` /
`run:failed` events, closing the connection at the terminal event
(`packages/server/src/routes/runs.ts`, unchanged). The GUI's only run
mechanism is a browser `EventSource` against this endpoint — no separate
polling loop, and it gives naturally live, step-by-step feedback as each
step finishes.

**Ability field:** since exactly one real Runner (`"rest"`) is registered
today, the GUI hardcodes `abilities: ["rest"]` on the submitted Actor rather
than offering a picker with one meaningless option. Actor *name* stays a
free-text field — still just a label today, not enforced by the dispatcher
(per the API Runner spec's "Screenplay Elements & Configuration" section).

## Form Fields → DSL Mapping

**Screenplay header:** Actor name (text), Task name (text).

**Variables editor** (→ `TestDefinition.variables`): key/value rows,
string values (e.g. `baseUrl`, `user`, `pass`, `orderId`).

**Request tab** (→ the one `interaction` step, `action: "request"`):

| Field | DSL target |
|---|---|
| Method (dropdown: GET/POST/PUT/PATCH/DELETE) | `with.method` |
| URL (text, supports `${var}`) | `with.url` |
| Params (key/value rows) | `with.query` |
| Headers (key/value rows) | `with.headers` |
| Auth (type selector: none/bearer/apiKey/basic, revealing matching fields) | `with.auth` |
| Body (raw JSON textarea, parsed client-side) | `with.body` |

Invalid JSON in Body blocks Run with an inline error — it never reaches the
backend as a malformed request.

**Extract tab** (→ `extract` steps, one row per extraction): each row has a
source-kind selector (`status` / `header` / `jsonPath`), the matching input
(none / header name / JSON path), and a "remember as" name. One row
generates:

```json
{ "type": "extract", "runner": "rest", "action": "jsonPath",
  "with": { "path": "$.data.paymentId" }, "remember": "paymentId" }
```

**Questions tab** (→ `question` steps, one row per assertion): same
source-kind selector as Extract, plus an "expected value" input. One row
generates:

```json
{ "type": "question", "runner": "rest", "action": "status",
  "expect": { "equals": 201 } }
```

No `remember` on Questions — that stays Extract's job, mirroring the
backend's own separation between the two step types.

**Assembled definition on Run:**

```json
{
  "actor": { "name": "<actor name>", "abilities": ["rest"] },
  "variables": { "...": "..." },
  "tasks": [
    { "name": "<task name>", "steps": [ "<request>", "...<extract rows>", "...<question rows>" ] }
  ]
}
```

**Result panels**, all derived client-side from the SSE step results — no
backend changes needed:

- **Response** — the `request` step's stored response: status, latency,
  headers, pretty-printed JSON body. `RunEvent` carries no timestamps, so
  latency is measured purely client-side — the wall-clock delta between the
  browser receiving the `request` step's `step:started` and
  `step:completed` SSE events.
- **Saved Values** — for each Extract row (only Extract rows have a
  `remember` name), its corresponding step result's `actual`, matched by
  array index (the GUI already knows which step index maps to which name,
  since it built the list in that order).
- **Context** — Saved Values plus the seeded `variables` — the full variable
  set as of run end.
- **Logs** — one line per step: type, action, status, and
  `actual`/`expected`/`error` for failures.

## Layout & Components

Stacked, single-column layout (confirmed via the visual companion):

```
┌──────────────────────────────────────────────┐
│ Task name input                    [Run]      │
├──────────────────────────────────────────────┤
│ Screenplay: Actor name                        │
├──────────────────────────────────────────────┤
│ Variables (key/value rows, add/remove)        │
├──────────────────────────────────────────────┤
│ Request                                       │
│ [Method▾] [URL............................]  │
│ Params | Headers | Auth | Body | Extract |    │
│ Questions  (tabbed sub-panel)                 │
├──────────────────────────────────────────────┤
│ Results: Response | Saved Values | Context |  │
│          Logs  (tabbed sub-panel)             │
└──────────────────────────────────────────────┘
```

**Components** (each independently understandable/testable):

- `App` — owns the test-definition form state and the current run's state;
  renders everything below.
- `ScreenplayHeader` — Actor/Task name inputs.
- `VariablesEditor` — generic key/value row-list UI (Params and Headers
  reuse the same row-list component).
- `RequestBuilder` — Method/URL, and the Params/Headers/Auth/Body sub-tabs.
- `ExtractEditor` / `QuestionsEditor` — row lists for extract/question rows,
  sharing a small "source kind" selector component.
- `RunButton` — assembles the `TestDefinition` via `buildTestDefinition`
  (see below), calls `POST /runs`, opens the `EventSource`, feeds events up
  to `App`.
- `ResultsPanel` — Response/Saved Values/Context/Logs sub-tabs, a pure
  function of the accumulated step results held in `App`'s state.

**State management:** plain React `useState`/`useReducer` in `App` — no
Redux/Zustand; this is one screen with no state to share across pages.

## Error Handling

- **Body JSON parse error** — inline message under the Body textarea; Run
  stays disabled until it's valid JSON (or empty).
- **Required fields** — Run is disabled until Task name, Method+URL, and
  every row's required inputs are filled in (path/header name for both;
  `remember` name for Extract rows; expected value for Question rows);
  invalid rows get an inline red outline.
- **`POST /runs` failure** (network error, or an unexpected 400) — banner
  with the error message. The GUI should never itself produce an invalid
  DSL, so a 400 here would indicate a bug in `buildTestDefinition`, not bad
  user input.
- **`EventSource` connection drop** — banner ("connection lost — partial
  results shown below"), keeping whatever step results already arrived;
  re-running is just clicking Run again.
- **A step failing during the run** (bad status, failed question, thrown
  error) — not a GUI error: Logs shows the failing step in red with
  `actual`/`expected`/`error`, reflecting the backend's existing fail-fast
  behavior. Response still shows the captured response if the `request`
  step itself succeeded before a later step failed.

## Testing Strategy

Vitest (matching the rest of the monorepo) plus React Testing Library for
components:

- Two pure functions, tested without rendering anything:
  - `buildTestDefinition(formState): TestDefinition` — the form-state-to-DSL
    assembly described above.
  - `deriveResults(rows, stepResults): { response, savedValues, context, logs }`
    — the results-panel derivation.
- Component tests: `VariablesEditor`/row-list add-remove behavior,
  `RequestBuilder` tab switching, `ResultsPanel` rendering from a fixed set
  of mock step results.
- Out of scope for this increment: automated browser-driven end-to-end tests
  against a live backend (e.g. Playwright) — manual verification only,
  consistent with this being a walking skeleton.

## Package Structure

```
packages/web/
├── package.json          # react, react-dom, vite, typescript, vitest, @testing-library/react
├── vite.config.ts         # dev server + proxy config (/runs* → :3000)
├── tsconfig.json
├── index.html
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── dsl.ts             # buildTestDefinition, row/step types
│   ├── results.ts         # deriveResults
│   ├── components/
│   │   ├── ScreenplayHeader.tsx
│   │   ├── KeyValueRows.tsx      # shared by Variables/Params/Headers
│   │   ├── RequestBuilder.tsx
│   │   ├── ExtractEditor.tsx
│   │   ├── QuestionsEditor.tsx
│   │   ├── RunButton.tsx
│   │   └── ResultsPanel.tsx
└── test/
    ├── dsl.test.ts
    ├── results.test.ts
    └── components/...
```

## Out of Scope

Deferred to later increments:

- gRPC and GraphQL GUIs.
- Advanced Mode GUI (reuse, conditions, loops, parallel, retry, polling,
  hooks, data-driven, test suites, code generation, CI/CD).
- Multi-task E2E flow builder UI.
- Any persistence: Project management, Save/Load, named Environments.
- Automated browser-driven end-to-end tests.
- Production build/deployment/serving strategy for the frontend.
