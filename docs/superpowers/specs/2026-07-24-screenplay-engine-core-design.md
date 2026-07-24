# Screenplay Engine (Core) — Design

## Context

This is the first sub-project of the AI-Native Testing Platform described in
[`docs/PRD.md`](../../PRD.md). The PRD defines five Runners (API, UI,
Database+Kafka/Redis, AI, Incident) that all sit behind a shared Screenplay
Engine, using the Actor → Ability → Task → Interaction → Question model. That
platform is too large for a single spec, so it is being decomposed into one
spec/plan/implementation cycle per piece:

1. **Screenplay Engine (Core)** — this document
2. API Runner
3. UI Runner
4. Database + Kafka/Redis Runner
5. AI Runner
6. Incident Runner

The Core is built first because every Runner plugs into it; it cannot be
meaningfully designed without the Core's plugin contract existing first.

The eventual product is a full web application (visual builder UI + backend).
This spec covers **backend only** — the Screenplay Engine as a service, with
no UI. A visual builder is designed later, either per-Runner or as its own
sub-project.

## Goal

A backend TypeScript engine implementing the Screenplay Pattern that:

- accepts a declarative JSON/YAML test definition,
- executes it asynchronously as a job,
- reports step-by-step and final results,
- and exposes a plugin interface so future Runners can register as step
  executors without any change to the engine itself.

## Architecture

```
Client (HTTP)
   │  POST /runs  { test definition }
   ▼
Fastify API Layer
   │  validates DSL (JSON Schema), creates Job, returns { jobId }
   ▼
Job Store (in-memory Map<jobId, JobState>)
   │
   ▼
Task Dispatcher (interpreter)
   │  walks Actor → Task → Interaction/Question tree
   │  resolves Variables from run Context
   │  emits step:started / step:completed / step:failed
   ▼
Runner Registry ──▶ registered Runner(s) (e.g. example Log/Echo Runner)
   │
   ▼
Run Context (Variables store, scoped per run)
```

## Domain Model

- **Actor** — a named entity with a set of **Abilities** (capabilities a
  Runner grants, e.g. "call HTTP", "log values").
- **Task** — a named sequence of steps (Interactions/Questions), which may
  include nested Tasks defined inline within the same test definition.
  Reuse of a Task across separate test definitions is out of scope for this
  spec.
- **Interaction** — an action step ("do something") dispatched to a Runner.
- **Question** — an assertion/read step ("ask something") dispatched to a
  Runner, whose answer is checked against an expectation.
- **Context** — per-run state holding **Variables** (e.g. `paymentId`
  remembered from a prior step) that later steps can reference.

## Test Definition DSL

A test is submitted as JSON (YAML accepted too, converted to the same shape
before validation). Example, modeled on the PRD's payment workflow:

```json
{
  "actor": {
    "name": "Authenticated Customer",
    "abilities": ["log"]
  },
  "tasks": [
    {
      "name": "Create Payment",
      "steps": [
        { "type": "interaction", "runner": "log", "action": "log", "with": { "message": "creating payment" } },
        { "type": "question", "runner": "log", "action": "echo", "with": { "value": 201 }, "expect": { "equals": 201 }, "remember": "statusCode" },
        { "type": "question", "runner": "log", "action": "echo", "with": { "value": "${statusCode}" }, "expect": { "equals": 201 } }
      ]
    }
  ]
}
```

Key points:

- `remember` writes a step's resolved value into the run's Variables under
  that name.
- `${varName}` in any `with`/`expect` field is resolved from Variables before
  the step executes.
- `runner` names which registered Runner handles that step's `action` — this
  is the plugin seam. For this spec, `"log"` is the only real runner (see
  below); real Runners register their own `action` vocabulary later.
- JSON Schema validates the overall shape at submission time (via Fastify's
  native schema support); unknown `runner`/`action` combinations are rejected
  before a job is created.

## Task Dispatcher & Execution Engine

The Task Dispatcher recursively interprets the definition tree: for each
Task, run its steps in order; each step is an Interaction or Question
dispatched to the Runner named in `runner`. Before dispatch, resolve any
`${var}` references from the run's Context. After a Question, compare the
resolved value against `expect` and record pass/fail. If `remember` is
present, write the value into Context.

**Execution & events:** each run executes as an independent async function.
The Dispatcher emits `step:started`, `step:completed`, `step:failed`, and
`run:completed`/`run:failed` on a per-job `EventEmitter`. The Job Store
subscribes to these events and updates the corresponding `JobState` (status,
current step, step results, remembered variables, final result).

**Failure handling — fail-fast:** on the first failed Interaction or
Question, remaining steps are marked `skipped`, the run stops, and
`run:failed` fires.

## Runner Plugin Interface

The contract every future Runner (API, UI, DB, AI, Incident) implements:

```ts
interface Runner {
  name: string; // matches the "runner" field in the DSL
  interact(action: string, args: Record<string, unknown>, ctx: RunContext): Promise<void>;
  ask(action: string, args: Record<string, unknown>, ctx: RunContext): Promise<unknown>;
}
```

Runners register at startup (`registry.register(runner)`); the Dispatcher
looks them up by name per step and calls `interact`/`ask` accordingly.

### Example runner

To prove the contract works end-to-end (not just in theory), this spec
includes a trivial `LogRunner` implementing `Runner`, with two actions:

- `log` (interact) — writes a message to the job's event log.
- `echo` (ask) — returns the given value unchanged, so it can be asserted
  against `expect` and optionally `remember`ed.

This is enough to execute the DSL example above without any real
HTTP/DB/browser integration.

## API Surface

- `POST /runs` — body: test definition JSON. Validates against JSON Schema;
  on success, creates a `JobState` (`status: "pending"`), starts execution
  asynchronously, and returns `{ jobId }` immediately (202 Accepted). On
  validation failure, returns 400 with schema errors.
- `GET /runs/:jobId` — returns the current `JobState` snapshot: `status`
  (`pending | running | passed | failed`), per-step results (name, status,
  resolved args, actual vs. expected, remembered vars), and timestamps. Safe
  to poll repeatedly.
- `GET /runs/:jobId/events` — optional Server-Sent Events stream of the same
  lifecycle events, for a future UI wanting live progress instead of
  polling (built on the EventEmitter from the dispatcher).

## Concurrency Model

Every `POST /runs` kicks off an independent async execution; there is no
global lock. Each run gets its own isolated `RunContext` — Variables are
never shared across runs. The `JobState` Map is keyed by `jobId` (UUID), so
concurrent runs don't interfere. No artificial concurrency cap in this spec —
Node's event loop handles interleaving; a real deployment-level limit (e.g.
worker pool, backpressure) is out of scope until load characteristics are
known.

## Persistence

In-memory only (`Map<jobId, JobState>` inside the Fastify process). No
database in this spec. Restarting the process loses all job history — this
is acceptable because the goal is proving the engine model, not building
production storage. A later sub-project can swap the Job Store behind the
same interface for a real database without touching the Dispatcher.

## Repo Structure

pnpm workspace monorepo:

```
/
├── pnpm-workspace.yaml
├── packages/
│   ├── engine/       # Actor/Ability/Task/Interaction/Question, Context,
│   │                 # Dispatcher, Runner interface, DSL schema
│   ├── runner-log/    # example LogRunner implementing the Runner interface
│   └── server/        # Fastify app: routes, Job Store, wires engine +
│                       # runner-log together
```

Each future Runner (API, UI, DB, AI, Incident) becomes its own
`packages/runner-*` workspace package, depending only on `engine`'s public
types.

## Testing Strategy

TDD with Vitest:

- `engine` — unit tests for Dispatcher tree-walking, Variable
  interpolation/`remember`, fail-fast semantics, event emission order.
- `runner-log` — unit tests for `interact`/`ask` behavior.
- `server` — integration tests hitting the Fastify routes (submit → poll →
  assert final `JobState`), including the SSE endpoint.

## Out of Scope

Deferred to later sub-projects:

- Real Runners (API, UI, DB, AI, Incident)
- Persistent database
- Auth/authz on the API
- The visual builder UI (Simple/Advanced mode)
- Multi-tenant concerns
- Retry/backoff policies
- Pause/resume of a run
- Reusing a Task definition across separate test definitions
