# Kafka Contract Check Integration Design

## Context

This is Step 4 of 4, the final step in the Kafka contract-testing initiative (Consumer module → Baseline Store → Diff Engine → **Integration**). It wires the first three steps' pure/backend-only building blocks — `collectKafkaMessages` (Step 1), versioned baseline files (Step 2), and `diffKafkaMessages` (Step 3) — into a real GUI feature: a "Kafka Contract Check" that a user can trigger from Simple Mode's Run button, tracked on its own dedicated results page.

This is a genuinely new, separate GUI surface — its own checkbox, its own store, its own route, its own page — coexisting with (not replacing) the existing ad-hoc Kafka Check Tracking system, which continues to use its own long-lived shared consumer and required-fields check entirely unchanged.

## Architecture & Data Flow

1. In Simple Mode's Request Builder, a new "Kafka Contract Check" section (checkbox + Topic dropdown + Version text field) sits alongside the existing "Check Kafka" section, independently toggleable.
2. On Run click, `RunButton.tsx` — the only place the existing Kafka Check registration happens today (`FlowRunner`/`ApiAutomationPage` never wired it in, so this feature stays scoped to Simple Mode too) — extracts the correlator value (reusing `extractCorrelatorValue`) and POSTs to a new `POST /kafka-contract-checks` endpoint with `{ message_id, name, topic, version }`.
3. Unlike the old system (which matches against an already-running shared consumer), this feature needs a fresh ephemeral consumer per registration. The route handler, when a real `kafka.yaml` is configured, fires an un-awaited background call that runs the state machine below.
4. A new "Kafka Contract Checks" sidebar page polls `GET /kafka-contract-checks` every 3s (mirroring `KafkaChecksPage`) and shows each row's status, expandable to the full diff report (findings grouped by severity) once resolved, or the error message if the check couldn't complete.

**Row state machine:**

```
POST /kafka-contract-checks
        │
        ▼
  Validate request ──invalid──▶ 400 (no row created)
        │ valid
        ▼
  Kafka configured? ──NO──▶ 503 (no row created — see "No-Config Handling")
        │ YES
        ▼
  Create row: PENDING  (201 response returned to the browser here)
        │
        ▼
  Start runKafkaContractCheck (un-awaited)
        │
        ▼
      RUNNING  (collectKafkaMessages in flight)
        │
        ├──── throws, or idle-timeout with no terminal status ────▶ ERROR (store errorMessage)
        │
        └──── terminal status SUCCESS or FAILED reached
                        │
                        ▼
              Load baseline {version}/{status}.json
                        │
              ┌─────────┴─────────┐
         missing/unreadable   found
              │                  │
              ▼                  ▼
            ERROR            diffKafkaMessages
        (store errorMessage)      │
                          ┌───────┴───────┐
                     result: passed   result: failed
                          │                │
                          ▼                ▼
                       PASSED            FAILED
                (store diffReport)  (store diffReport)
```

`terminalStatuses` for this runner is `['SUCCESS', 'FAILED']` — narrower than Step 2's capture scripts, which also treat `PENDING` as terminal. A transaction that only ever reaches `PENDING` isn't a meaningful contract-check outcome here, so it falls out through the idle-timeout path into `ERROR` instead of triggering a diff. `ERROR` is a single row status covering three distinct causes — a `collectKafkaMessages` failure, an idle-timeout with no terminal status seen, and a missing/unreadable baseline file — each skipping the diff step entirely and storing a descriptive `errorMessage`. Note that `FAILED` appears at two different points in this diagram with two different meanings: a `FAILED` *business* status from the actual transaction (which still gets diffed against its own `FAILED.json` baseline, same as `SUCCESS` does) is not the same thing as a `FAILED` *diff result* (an actual contract violation) — both happen to reuse the same word, but the row's final `status` field always reflects the diff outcome, not the business status.

**Safety constraint, preserved from the existing system:** `buildApp()` (what tests use) must never touch a real Kafka broker. The old system enforces this by starting its long-lived consumer only from `index.ts`, never from `buildApp()`. This feature's trigger is different in kind (per-request, not a standing consumer), but needs the identical guarantee: the route only fires the real `collectKafkaMessages` call when a real `KafkaConfig` object is explicitly passed in. `buildApp()`'s test wiring passes `undefined`, so the route safely degrades under test — see "No-Config Handling" below for what it does instead of silently creating an unresolvable row.

## Baseline Directory Relocation

Baseline files move from `process.cwd()`-relative `kafka-baselines/` to `packages/server/data/kafka-baselines/`, which is already entirely gitignored (`packages/server/data/` is in `.gitignore`) — this real captured-message data never needs a separate ignore rule, consistent with how `kafka-checks.json`/`steps.json` are already treated.

- `packages/web/scripts/capture-baseline.ts` and `update-baseline.ts` gain a `--baselines-dir` flag, defaulting to `join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'data', 'kafka-baselines')` — computed the same way `capture-baseline.ts` already computes its `kafka.yaml` default.
- `packages/web/scripts/write-baseline.ts`'s internal `DEFAULT_BASELINES_DIR` constant is updated to the same resolved path, so a bare script run with no flag still lands in the right place.
- The server's read side uses `join(DEFAULT_DATA_DIR, 'kafka-baselines')` (`DEFAULT_DATA_DIR` already exists in `app.ts`), landing on the identical directory.

## Data Structures

**`packages/server/src/kafka-contract-check-store.ts`** (mirrors `KafkaCheckStore`):

```ts
export type KafkaContractCheckStatus = 'pending' | 'passed' | 'failed' | 'error';

export interface KafkaContractCheckRow {
  message_id: string;   // the transId — same identity convention as KafkaCheckRow
  name: string;
  topic: string;
  version: string;
  status: KafkaContractCheckStatus;
  diffReport: DiffReport | null;
  errorMessage: string | null;
  created_at: string;
  updated_at: string;
}
```

Same shape as `KafkaCheckStore`: flat JSON file, `list`/`get`/`create`/`update` methods, `mkdir`+`writeFile` on write.

**`packages/server/src/kafka-contract-check-runner.ts`** — the orchestrator, called (un-awaited) from the route:

```ts
export async function runKafkaContractCheck(
  row: KafkaContractCheckRow,
  kafkaConfig: KafkaConfig,
  baselinesDir: string,
  store: KafkaContractCheckStore
): Promise<void>
```

It calls `collectKafkaMessages` (topic/brokers/correlatorField/hasDataWrapper resolved from `KAFKA_TOPIC_DEFINITIONS[row.topic]`, `transId: row.message_id`, `statusField: 'status'`, `terminalStatuses: ['SUCCESS', 'FAILED']` — narrower than Step 2's capture scripts, which also treat `PENDING` as terminal — `idleTimeoutMs: 15000`, same timeout Step 2 uses), then follows the state machine above:
- collection throws → `status: 'error'`, `errorMessage` describing the failure.
- `terminatedBy !== 'terminal-status'` (idle-timeout, including a transaction that only ever reached `PENDING`) → `status: 'error'`, `errorMessage` noting the timeout.
- baseline file at `{baselinesDir}/{row.version}/{actualStatus}.json` doesn't exist or fails to parse → `status: 'error'`, `errorMessage` naming the missing path.
- otherwise → `diffKafkaMessages(baseline.messages, result.messages, row.topic)`, then `status: diffReport.result` (`'passed'`/`'failed'`), `diffReport` stored.

**`packages/server/src/routes/kafka-contract-checks.ts`**:

```ts
export function registerKafkaContractCheckRoutes(
  app: FastifyInstance,
  store: KafkaContractCheckStore,
  kafkaConfig: KafkaConfig | undefined,
  baselinesDir: string
): void
```

`GET /kafka-contract-checks` → `store.list()`. `POST /kafka-contract-checks` validates `message_id`/`name`/`topic`/`version` (400 if missing/invalid, mirroring `/kafka-checks`'s existing validation), then:
- if `kafkaConfig` is `undefined` → responds with an error (503) and creates no row (see "No-config handling" below).
- otherwise → creates the `pending` row, responds `201`, and fires `runKafkaContractCheck(row, kafkaConfig, baselinesDir, store)` without awaiting it.

`buildApp()` wires this route with `kafkaConfig: undefined` always (tests never configure a real broker); `index.ts` wires the real loaded config when present, alongside its existing `kafkaConfig` check for the old system.

## No-Config Handling

Unlike the old system (which has a 60s timeout sweep that eventually resolves any stuck `pending` row regardless of cause), this feature has no external sweep — each check's own `collectKafkaMessages` call is what resolves it. If no `kafka.yaml` is configured at all, nothing would ever process a created row, leaving it misleadingly stuck at `pending` forever. `POST /kafka-contract-checks` rejects the registration outright (503, no row created) when `kafkaConfig` is `undefined`, rather than creating an unresolvable row. The frontend surfaces this the same way `RunButton.tsx` already surfaces a failed Check-Kafka registration — via its existing `onError` callback.

## Frontend Wiring

- `types.ts`: new `KafkaContractCheckFormState { enabled: boolean; topic: KafkaTopic; version: string }`, added to `FormState` as `kafkaContractCheck`. `App.tsx`'s `initialForm()` defaults it to `{ enabled: false, topic: 'transLogV1', version: '' }`.
- `steps.ts`'s `normalizeFormState` gains `kafkaContractCheck: form.kafkaContractCheck ?? { enabled: false, topic: 'transLogV1', version: '' }` — this is the exact chokepoint that already prevented a real production blank-page crash once before when a new `FormState` field was added without backfilling old saved steps ([[project_stale_saved_step_missing_field_gotcha]]), so it applies here too.
- `RequestBuilder.tsx`: new section mirroring the existing "Check Kafka" block (checkbox, conditional Topic `<select>`, plus a Version `<input>` when enabled).
- `kafkaContractChecks.ts` (new, mirrors `kafkaChecks.ts`): `registerKafkaContractCheck({ message_id, name, topic, version })`, `fetchKafkaContractChecks()`.
- `RunButton.tsx`: extends its existing `if (form.kafkaCheck.enabled) { ... }` block with a parallel, independent `if (form.kafkaContractCheck.enabled) { ... }` block — same `extractCorrelatorValue`/error-handling shape, calling `registerKafkaContractCheck` instead. Also checks `form.kafkaContractCheck.version.trim() !== ''` before registering, surfacing `"Kafka Contract Check: version is required."` via the existing `onError` callback if blank (the same client-side-guard-before-network-call shape already used for a missing correlator value) — the server's own validation would reject an empty version too, but this gives the same immediate, specific error message the correlator-value check already gives.
- `KafkaContractChecksPage.tsx` (new, mirrors `KafkaChecksPage.tsx`): polling list; expanding a row shows its `errorMessage` (if `error`), or the `diffReport`'s findings grouped/labeled by severity (once `passed`/`failed`).
- `Sidebar.tsx` + `App.tsx`: new nav entry and route, `/kafka-contract-checks`.
- `vite.config.ts`: add `/kafka-contract-checks` to the dev proxy — this exact class of gap (a new server route missing from the proxy) has bitten this project twice already ([[project_vite_proxy_new_route_gotcha]]).

## Testing

**Server:**
- `kafka-contract-check-store.test.ts` — CRUD, mirrors `kafka-check-store.test.ts`.
- `kafka-contract-check-runner.test.ts` — mocks only `collectKafkaMessages` (the real Kafka boundary, via the established `vi.hoisted()` pattern); uses real temp-directory baseline files (mirroring `write-baseline.test.ts`'s `mkdtemp`/`rm` approach) and the real `diffKafkaMessages` (already pure and cheap, no need to mock it). Cases: resolves `passed` (no critical findings); resolves `failed` (critical findings present); resolves `error` when `collectKafkaMessages` rejects; resolves `error` when `terminatedBy === 'idle-timeout'`; resolves `error` when the baseline file for `{version}/{actualStatus}.json` doesn't exist.
- `routes/kafka-contract-checks.test.ts` — mirrors `kafka-checks-routes.test.ts`: POST validates required fields, returns `201` with a `pending` row when a `KafkaConfig` is supplied; returns an error response with no row created when `kafkaConfig` is `undefined` — this test doubles as the automated proof that `buildApp()`'s test wiring never fires a real Kafka connection.

**Frontend:** `kafkaContractChecks.test.ts` (mirrors `kafkaChecks.test.ts`), `RequestBuilder.test.tsx` additions (new section renders/toggles), `RunButton.test.tsx` addition (registers when enabled), `KafkaContractChecksPage.test.tsx` (mirrors `KafkaChecksPage.test.tsx`, plus rendering an `error` row's message and a resolved row's diff findings by severity), `steps.test.ts` addition (old-step backfill), `Sidebar.test.tsx` addition.

## Error Handling Summary

- No `kafka.yaml` configured → registration rejected outright (503), no row created.
- Collection failure, idle-timeout (no terminal status seen), or missing baseline file → row resolves to `error` with a descriptive message, never silently stuck at `pending`.
- Malformed registration request (missing `message_id`/`name`/`topic`/`version`, or an unrecognized `topic`) → `400`, mirroring `/kafka-checks`'s existing validation.

**Manual verification caveat, consistent with every prior Kafka increment in this sub-project:** this sandbox has no real broker access, so the live `collectKafkaMessages`-through-`diffKafkaMessages` path can only be verified via mocked tests — end-to-end proof (a real message flowing through a real broker) remains an explicitly accepted gap, same as Steps 1-3.
