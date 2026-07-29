# Actor/Task Dropdown with Persistence — Design

## Context

The REST GUI (`packages/web`, merged to `main`) currently has plain free-text
`Actor` and `Task` inputs in `ScreenplayHeader`. The request: turn both into
comboboxes — pick a previously-used value, or type a new one — with new
values genuinely saved so they're available next time, not just for the
current page load.

A much larger product vision document was added during this round,
[`docs/PRD_APIRunner.md`](../../PRD_APIRunner.md) (Dashboard, Step
Repository, drag-and-drop E2E Flow Builder, Advanced Screenplay Editor,
gRPC, reporting). This spec is a small, deliberately-scoped first step
toward that vision's "reuse a Task/Actor instead of recreating it" idea —
not an attempt to build any of the rest of that document. A separately
proposed "Paste cURL" addition (also part of that larger vision) was
explicitly deferred to its own future brainstorming round, to keep this
spec focused on one thing.

## Goal

Let a user pick a previously-used Actor or Task name from a dropdown, or
type a new one — and have new values persist across server restarts, so
next time the GUI is opened, past choices are still there.

## Scope

**In scope:**
- Two new backend endpoints (`/actors`, `/tasks`) backed by flat JSON files
  on disk — genuine persistence, not in-memory/session-only, not
  localStorage.
- A native `<datalist>`-based combobox for both the `Actor` and `Task`
  fields in `ScreenplayHeader`.
- Saving a new value only when Run is clicked (not on every keystroke/blur).

**Out of scope:**
- "Paste cURL" (separate future brainstorming round).
- Everything else in `PRD_APIRunner.md` (Dashboard, Step Repository,
  E2E Flow Builder, Advanced Screenplay Editor, gRPC, reporting/artifacts,
  imports beyond this).
- Any real "Actor"/"Task" domain modeling — these remain bare name strings,
  exactly as today; `Actor.abilities` stays hardcoded to `["rest"]`.
- Editing or deleting a previously-saved name (this spec only ever appends).

## Architecture

```
Browser                                   packages/server
┌─────────────────────┐   GET /actors     ┌──────────────────────────┐
│ App (on mount)       │ ────────────────▶│ NameListStore            │
│  actorOptions[]      │◀──────────────── │  (data/actors.json)      │
│  taskOptions[]       │   GET /tasks     │ NameListStore            │
│                      │ ────────────────▶│  (data/tasks.json)       │
│ ScreenplayHeader     │◀────────────────  └──────────────────────────┘
│  <datalist> per field│
│                      │   POST /actors {name}   (on Run, if new)
│ RunButton (unchanged)│ ────────────────▶
└─────────────────────┘
```

**Storage:** `packages/server/data/actors.json` and `data/tasks.json` — each
a flat JSON array of strings (e.g. `["Authenticated Customer", "Admin"]`).
Both files are gitignored (runtime user data, not source); auto-created
with `[]` on first read if missing.

**`NameListStore`** (`packages/server/src/name-list-store.ts`), one
instance per file:
- `list(): Promise<string[]>` — reads the file, creating it with `[]` first
  if it doesn't exist (`ENOENT`). Any other read/parse error propagates (a
  genuine filesystem problem, not a normal first-run case).
- `add(name: string): Promise<string[]>` — reads, appends `name` only if
  not already present (exact string match, no case-normalization), writes
  back, returns the updated list.

**Routes** (`packages/server/src/routes/name-lists.ts`), identical shape
for both resources:
- `GET /actors` → `string[]`
- `POST /actors` with body `{ name: string }` → `201 { names: string[] }`
  (the full updated list); `400` if `name` is missing or blank
- `GET /tasks` / `POST /tasks` — same shape, backed by the other store

## Frontend Wiring

**`App.tsx`:**
- New state: `actorOptions: string[]`, `taskOptions: string[]`.
- On mount (`useEffect`), fetch `GET /actors` and `GET /tasks` once. A
  failure leaves that list empty — no error banner; an empty suggestion
  list just means the field behaves like a plain text input, same as today.
- The existing `onRunStart` callback (already passed to `RunButton`,
  **unchanged**) gains one more responsibility before it clears
  error/results: if `form.actorName` is non-empty and not already in
  `actorOptions`, fire-and-forget `POST /actors` and add it to
  `actorOptions` immediately (optimistic — usable in the dropdown this
  session even before the request resolves). Same check for
  `form.taskName` → `/tasks`.
- Passes `actorOptions`/`taskOptions` down to `ScreenplayHeader`.

**`ScreenplayHeader.tsx`:** gains two new required props, `actorOptions:
string[]` and `taskOptions: string[]`. Each `<input>` gets a
`list="actor-options"` / `list="task-options"` attribute pointing at a
sibling `<datalist>` rendering one `<option>` per value. The inputs remain
fully controlled and still accept any free-text value — a `<datalist>`
never restricts input, it only suggests.

**New `packages/web/src/nameLists.ts`:**
- `fetchNames(endpoint: '/actors' | '/tasks'): Promise<string[]>` — GET,
  returns `[]` on any failure (network error or non-2xx).
- `saveName(endpoint: '/actors' | '/tasks', name: string): void` —
  fire-and-forget POST; errors are silently ignored.

**Vite proxy** (`vite.config.ts`): add `/actors` and `/tasks` alongside the
existing `/runs` entry.

## Error Handling

- `GET /actors`/`/tasks` failing → empty list, no banner, field still works
  as free text.
- `POST /actors`/`/tasks` failing → silently ignored; the value is still
  usable this session via the optimistic local-state update, it just won't
  have persisted to disk for next time. Never blocks or interferes with the
  Run already in progress.
- Backend: `NameListStore.list()` auto-creates a missing file; any other
  read/parse error is a genuine `500` (a corrupt file or permissions
  problem is not a "first run" case and shouldn't be silently swallowed).

## Testing

- Backend: unit tests for `NameListStore` (list/add/dedup/auto-create on
  missing file, using a temp directory per test so tests never touch real
  data files or each other) and route tests for `GET`/`POST /actors` and
  `/tasks`, mirroring the existing `job-store.test.ts`/`runs.test.ts`
  patterns.
- Frontend: unit tests for `nameLists.ts` (mocked `fetch`); updated
  `ScreenplayHeader.test.tsx` for the new `actorOptions`/`taskOptions` props
  and `<datalist>` rendering; updated `App.test.tsx` — its existing blanket
  `fetch` mock (which currently resolves *any* call, including the new
  `GET /actors`/`/tasks` calls `App` now makes on mount) must be changed to
  discriminate by URL, so those new calls return proper string arrays
  instead of accidentally receiving the `/runs`-shaped mock response.

## Out of Scope

Deferred:

- "Paste cURL" (separate future brainstorming round).
- Everything else in `PRD_APIRunner.md`: Dashboard/Catalog, Step
  Repository, drag-and-drop E2E Flow Builder, Advanced Screenplay Editor,
  gRPC support, reporting/artifacts, Swagger/OpenAPI/Proto import.
- Editing/deleting a previously-saved Actor or Task name.
- Any real Actor/Task domain modeling beyond bare name strings.
