# API Runner (REST, Simple Mode) — Design

## Context

This is the second sub-project of the AI-Native Testing Platform described in
[`docs/PRD.md`](../../PRD.md), following the [Screenplay Engine
(Core)](2026-07-24-screenplay-engine-core-design.md), which is merged to
`main`. Sub-project order:

1. Screenplay Engine (Core) — done
2. **API Runner** — this document
3. UI Runner
4. Database + Kafka/Redis Runner
5. AI Runner
6. Incident Runner
7. Performance K6 Runner

The Core spec deliberately shipped as a walking skeleton: a plugin contract
(`Runner.interact`/`Runner.ask`, registered in a `RunnerRegistry`), a Task
Dispatcher that resolves `${var}` references and fail-fast executes a step
tree, and only a trivial `LogRunner` to prove the contract. It explicitly
deferred all real Runners and all "Advanced Mode" execution semantics
(reusable Tasks across definitions, Conditions, Loops, Parallel, Retry,
Polling, Hooks, Data-driven testing).

The PRD's own "API Runner" section is itself far larger than one sub-project:
REST *and* gRPC *and* GraphQL, Simple Mode *and* a much richer Advanced Mode
(reuse, conditions, loops, parallel, retry, polling, hooks, data-driven, test
suites, code generation, CI/CD), plus a full GUI. Consistent with how Core was
scoped, and with the project's established preference for phasing new
requirements into a follow-up sub-project rather than absorbing everything up
front, this spec narrows to a walking skeleton for API Runner: **REST only,
Simple Mode execution semantics only, backend-only.**

## Goal

A real `Runner` implementation that executes REST HTTP requests through the
existing Screenplay Engine — unmodified in its core execution model — proving
the plugin contract works for something beyond the `LogRunner` demo, and
giving the platform its first genuinely useful capability: real API testing
with request chaining (extract a value from one response, use it in a later
request), consistent with the PRD's Login → Create Payment → Get Payment
Status example.

## Scope

**In scope:**

- REST methods: GET, POST, PUT, PATCH, DELETE.
- Both a single API test and an end-to-end API flow (multiple Tasks in one
  test definition), using Core's existing `${var}` resolve/`remember`
  mechanism for chaining — no new chaining mechanism.
- Auth convenience helpers: Bearer token, API key, Basic auth.
- Response extraction (HTTP status, header, JSONPath-lite into a JSON body)
  and assertions, via Core's existing Question (`expect.equals`) mechanism
  plus one small, additive engine change (see below).
- Backend/engine-level only. No GUI.

**Out of scope, deferred to later sub-projects:**

- gRPC, GraphQL.
- Advanced Mode: reusable Actors/Abilities/Tasks/Interactions/Questions across
  separate test definitions, Conditions, Loops, Parallel branches, Retry
  policies, Polling, Hooks, Data-driven testing, Test Suites, Code generation,
  Headless/CI-CD execution — all consistent with what Core already deferred.
- Import (OpenAPI, cURL, Postman collections).
- OAuth2 flow, mTLS (these need credential/certificate management this
  walking skeleton doesn't have; Bearer/API key/Basic cover the common case).
- Any visual builder/GUI.
- Persistent storage, auth on the platform's own management API (still
  in-memory and unauthenticated, per Core).

## Engine Addition: the `extract` Step

Core's only step types are `interaction` (do something, no result) and
`question` (ask something, compare via `expect.equals`, optionally
`remember`). This is fine for real assertions, but awkward for the common
case of extracting a value purely to reuse it later (e.g. a server-generated
`paymentId`) — you'd otherwise have to already know the value to write a
passing `expect.equals`.

This spec adds a third step type, `extract`, scoped narrowly to this need:

```ts
export interface ExtractStep {
  type: 'extract';
  runner: string;
  action: string;
  with?: Record<string, unknown>;
  remember: string;
}
```

Dispatcher behavior: resolve `with` from Context (as for other steps), call
`runner.ask(action, args, ctx)`, then unconditionally `ctx.remember(remember,
actual)` and emit `step:completed` — there is no pass/fail comparison. It
only fails (`step:failed` / fail-fast) if the Runner's `ask` call itself
throws (e.g. a malformed JSONPath, or extracting from a non-JSON body).

This requires updating `packages/engine`:

- `types.ts` — add `ExtractStep` to the `Step` union and `LeafStep`; extend
  `StepResult['type']` to include `'extract'`.
- `schema.ts` — add the `extract` variant to the step `oneOf`
  (`required: ['type', 'runner', 'action', 'remember']`).
- `dispatcher.ts` — add the `extract` branch alongside the existing
  `interaction`/`question` branches in `executeSteps`.

`question` and its `expect.equals` comparator are unchanged; `extract` is
purely additive. This is the only change to `packages/engine` in this
sub-project — everything else (Context, Runner interface, RunnerRegistry,
event model, fail-fast semantics) is untouched.

## REST Runner: Action Vocabulary

New package `packages/runner-api`, registered under the name `rest`.

| Step type | `action` | `with` | Behavior |
|---|---|---|---|
| `interaction` | `request` | `method, url, headers?, query?, body?, auth?` | Sends the HTTP request. Stores the response (`status`, `headers`, `body`) under a reserved Context key (`__rest.lastResponse`) so later steps can read it. Throws only on transport-level failure (DNS, connection refused, timeout) — a non-2xx HTTP status is not an error, so negative/boundary tests (expecting a 404, a 400, etc.) work naturally. |
| `question` or `extract` | `status` | — | Returns the last response's HTTP status code. |
| `question` or `extract` | `header` | `name` | Returns a specific response header value. |
| `question` or `extract` | `jsonPath` | `path` (e.g. `$.data.paymentId`) | Extracts a value from the last response's JSON body via a minimal hand-rolled JSONPath subset (dot + bracket-index notation only — not the full JSONPath spec). Throws if the body isn't JSON or the path doesn't resolve. |

`auth` in `request`'s `with` is a small convenience object, one of:

- `{ "type": "bearer", "token": "..." }` → sets `Authorization: Bearer <token>`
- `{ "type": "apiKey", "header": "X-API-Key", "value": "..." }` → sets that header
- `{ "type": "basic", "username": "...", "password": "..." }` → sets `Authorization: Basic <base64>`

Anyone can bypass this and set `Authorization` directly via `headers` instead.

**No changes to `Actor.abilities`.** It stays `string[]` (e.g. `["rest"]`) —
base URL, tokens, and other config are ordinary variables referenced via
`${var}` in each `request` step's `with`, resolved by Core's existing
`RunContext.resolve`. This keeps the shared engine/schema untouched for
Actor/Ability and matches the PRD's own REST GUI example, which interpolates
`{{baseUrl}}` directly into the request.

### Example: end-to-end flow

```json
{
  "actor": { "name": "Authenticated Customer", "abilities": ["rest"] },
  "tasks": [
    {
      "name": "Login",
      "steps": [
        { "type": "interaction", "runner": "rest", "action": "request",
          "with": { "method": "POST", "url": "${baseUrl}/login",
                    "body": { "user": "${user}", "pass": "${pass}" } } },
        { "type": "question", "runner": "rest", "action": "status",
          "expect": { "equals": 200 } },
        { "type": "extract", "runner": "rest", "action": "jsonPath",
          "with": { "path": "$.data.accessToken" }, "remember": "accessToken" }
      ]
    },
    {
      "name": "Create Payment",
      "steps": [
        { "type": "interaction", "runner": "rest", "action": "request",
          "with": { "method": "POST", "url": "${baseUrl}/v1/payments",
                    "auth": { "type": "bearer", "token": "${accessToken}" },
                    "body": { "orderId": "${orderId}", "amount": "${amount}" } } },
        { "type": "question", "runner": "rest", "action": "status",
          "expect": { "equals": 201 } },
        { "type": "extract", "runner": "rest", "action": "jsonPath",
          "with": { "path": "$.data.paymentId" }, "remember": "paymentId" }
      ]
    },
    {
      "name": "Get Payment Status",
      "steps": [
        { "type": "interaction", "runner": "rest", "action": "request",
          "with": { "method": "GET", "url": "${baseUrl}/v1/payments/${paymentId}",
                    "auth": { "type": "bearer", "token": "${accessToken}" } } },
        { "type": "question", "runner": "rest", "action": "jsonPath",
          "with": { "path": "$.data.status" }, "expect": { "equals": "SUCCESS" } }
      ]
    }
  ]
}
```

## Architecture

```
Client (HTTP)
   │  POST /runs  { test definition with "extract" steps and "rest" runner }
   ▼
Fastify API Layer (unchanged) — validates DSL, creates Job, returns { jobId }
   ▼
Task Dispatcher (+ new "extract" branch)
   │  walks Actor → Task → Interaction/Question/Extract tree
   ▼
Runner Registry ──▶ RestRunner (new)
   │                    │  fetch() over the network, AbortController timeout
   │                    │  stores response in Context under __rest.lastResponse
   ▼
Run Context (unchanged) — Variables store, scoped per run
```

**HTTP client:** Node's built-in `fetch` — no new runtime dependency. A
default request timeout (e.g. 30s) via `AbortController`, so a hung request
can't stall a run forever; this is baseline HTTP hygiene, not the deferred
"retry/polling policy" Advanced Mode feature.

**Response storage:** kept entirely inside `RunContext`'s existing
`Map<string, unknown>` under the reserved key `__rest.lastResponse`. No
changes to `RunContext` itself — `remember`/`get`/`resolve` are reused as-is.
Each `request` overwrites this key, so `status`/`header`/`jsonPath` steps
must run against the *most recent* response before the next `request` fires —
matching the PRD's own pattern of extracting/asserting immediately after each
call. Comparing two responses from earlier in the same flow side-by-side is
not supported; that would need named/multiple response handles, which is
unnecessary complexity for this walking skeleton.

**Error handling:**

- Transport failure (DNS, connection refused, timeout) → `request` throws →
  existing fail-fast handling marks the step failed, run fails.
- Non-2xx HTTP status → not an error; `request` completes normally, and a
  subsequent `status`/`jsonPath` question decides pass/fail.
- Malformed JSONPath, or extracting from a non-JSON body → the `jsonPath`
  action throws → same fail-fast handling (for `question`) or step-failed
  (for `extract`, since `extract` has no pass/fail state of its own).

## Package Structure

```
packages/runner-api/
├── src/
│   ├── rest-runner.ts   # RestRunner implementing engine's Runner interface
│   ├── auth.ts          # bearer/apiKey/basic header helpers
│   └── json-path.ts     # minimal dot/bracket-index extractor
└── test/
```

Depends only on `@ai-native-testing/engine`'s public types, matching
`runner-log`'s existing pattern.

## Testing Strategy

TDD with Vitest, matching Core's existing strategy:

- `engine` — new unit tests for the `extract` step: schema validation (valid
  and invalid shapes) and dispatcher behavior (remembers unconditionally,
  fails the step if `ask` throws, does not affect run status on success).
- `runner-api` — unit tests spin up a throwaway local HTTP server
  (`node:http`) so tests hit a real socket without any external dependency.
  Covers: each HTTP method, headers/query/body construction, each `auth`
  helper, `status`/`header`/`jsonPath` actions (including JSON and non-JSON
  bodies, missing paths), and timeout behavior.
- `server` — one integration test running a full Login → Create Payment →
  Get Payment Status flow through `POST /runs` against the local test server,
  polling `GET /runs/:jobId` for the final passed `JobState`.

## Out of Scope

Deferred to later sub-projects:

- gRPC, GraphQL protocol support.
- Advanced Mode execution semantics: reuse of Actors/Abilities/Tasks/
  Interactions/Questions across separate test definitions, Conditions,
  Loops, Parallel branches, Retry policies, Polling, Hooks, Data-driven
  testing, Test Suites.
- Code generation, headless/CI-CD execution.
- Import (OpenAPI, cURL, Postman).
- OAuth2 flow, mTLS.
- The visual builder UI (Simple/Advanced mode GUI).
- Persistent database, auth on the platform's own management API.
