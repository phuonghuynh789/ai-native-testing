# Before Invoke / After Response Params — Design Spec

## Goal

Add two new tabs to Simple Mode's Request card — "Before invoke" and "After response" — that let a user set template variables via plain key/value rows (no script), matching Postman's pre-request/post-response scripts in effect but not in mechanism. Also restyle every key/value row (Params, Headers, Variables, Metadata, and the two new tabs) with `+`/`✕` icon controls instead of text buttons.

## Scope

**In scope:**

- **"Before invoke" tab** (first tab, both REST and gRPC): renders the exact same list as the existing top-level "Variables" section (same `form.variables` array, same effect — seeded into `RunContext` before any step runs, referenced via `${key}` anywhere). This is a second UI entry point onto existing data, not a new mechanism. The top-level "Variables" section stays exactly as-is.
- **A `$now` dynamic value**: typing the literal value `$now` in any key/value row handled by the shared `rowsToRecord` (Params, Headers, Variables/Before invoke, Metadata) resolves to the current Unix timestamp in milliseconds (`Date.now()`, as a string) at the moment Run is clicked — client-side, no engine change. Ships as exactly one reserved value this increment; not a general expression language.
- **"After response" tab** (both REST and gRPC, placed immediately before "Extract"): a key/value list where the value can be a literal string or reference the just-completed response via `${response...}` syntax, e.g. `${response.body.foo}`, `${response.body.items[0].id}`, `${response.headers.x-request-id}`, `${response.status}`. Each row becomes a new context variable, usable via `${key}` in later steps of the same flow.
- **Engine change**: `RunContext.resolveValue` (`packages/engine/src/context.ts`) currently only matches bare `${varName}` (`\w+`, no dots/brackets). Its two regexes widen to `[\w.\[\]]+`; a path with a `.`/`[` splits into `varName` + a remainder handed to the engine's existing, already-tested `extractJsonPath` (`packages/engine/src/json-path.ts`) as a synthesized `$.`-prefixed JSONPath string. Plain `${varName}` keeps its exact current behavior (backward compatible, verified: existing `context.test.ts` cases are all still `\w+`-only and remain valid).
- **Rename the hidden response variable**: `HIDDEN_RESPONSE_VARIABLE` (`packages/web/src/dsl.ts`) changes value from `'__response'` to `'response'`. Traced every reference in the codebase (source and tests) — exactly one call site (`dsl.ts`'s own `buildTaskSteps`) uses the literal string; everything else (`results.ts`) uses an unrelated, purely positional constant. Safe, no other change needed.
- **New step kind for "After response" rows**: each non-blank row becomes `{type: 'extract', runner: 'log', action: 'echo', with: {value: row.value}, remember: row.key}`. No `runner-log` change needed at all — the dispatcher already resolves every step's entire `with` object via `ctx.resolve()` *before* calling the runner (confirmed in `dispatcher.ts`), so by the time `LogRunner.ask('echo', args, ctx)` runs, `args.value` is already the fully-substituted string; `LogRunner`'s existing `echo` action (`return args.value`) is already exactly the "return this already-resolved value" primitive this needs. Reuses the already-registered, protocol-agnostic `LogRunner` rather than duplicating anything into `RestRunner`/`GrpcRunner`, and needs zero new runner code.
- **Icon-style key/value rows, applied everywhere `KeyValueRows` is used**: the per-row remove button shows `✕` (kept as its existing `aria-label`, so it's still exactly as accessible and exactly as discoverable by existing tests). The list's single add button becomes `+ Add {label} row` with an explicit new `aria-label="Add {label} row"` matching its current accessible name exactly (previously implicit from text content). Traced every test that queries these buttons — exactly two lines in `KeyValueRows.test.tsx` query by accessible name, both unaffected by this change since `aria-label` determines the accessible name regardless of visible glyph content. No other test file queries these button names.

**Out of scope (deliberately deferred):**

- Any templating syntax other than `${...}` (e.g. Postman's `{{...}}`) — the app's one existing mechanism is extended, not duplicated.
- Any dynamic/computed value beyond `$now` (e.g. `$uuid`, `$randomInt`) — easy to add later the same way, not built preemptively.
- Per-row inline "insert after this row" controls — add stays a single button at the list's end.
- Any change to `ExtractEditor`/`QuestionsEditor` — structurally different components (3–4 fields per row: source/path/rememberAs or source/path/expected), not `KeyValueRows`, and not part of this request.
- Any change to ExtractEditor/Questions' existing `${...}` support in their own fields — unaffected, unrelated code paths.

## Architecture & Data Flow

**Before invoke:** `RequestBuilder` gains `variables: KeyValueRow[]` / `onVariablesChange` props (threaded from `SimpleModePage`, same array `form.variables` the top-level Variables section already renders). The new tab renders `<KeyValueRows label="Before invoke" rows={variables} onChange={onVariablesChange} />`. No `dsl.ts` change — `buildTestDefinition`/`buildFlowDefinition` already turn `form.variables` into `TestDefinition.variables`, seeded into `RunContext` before any task's steps run.

**`$now`:** `dsl.ts`'s shared `rowsToRecord(rows)` — used for Params, Headers, Variables, and gRPC Metadata — resolves any row whose value is exactly `$now` to `String(Date.now())` before building the record. Purely client-side, evaluated once at the moment `buildTestDefinition`/`buildFlowDefinition` runs (i.e. when Run is clicked), before the definition is POSTed.

**After response:** `FormState` gains `afterResponse: KeyValueRow[]`. `RequestBuilder` gains `afterResponse`/`onAfterResponseChange` props, rendering `<KeyValueRows label="After response" rows={afterResponse} onChange={onAfterResponseChange} />` plus a one-line hint about `${response...}` syntax. `buildTaskSteps` appends one `log`/`echo` extract step per non-blank row, after the existing user-defined Extract rows and before Questions:

```
[interaction, raw-extract (remember: 'response'), ...user extracts, ...after-response rows, ...questions]
```

At runtime, the dispatcher resolves each step's `with` object via `ctx.resolve()` *before* invoking the runner (existing behavior, unchanged) — so `{value: '${response.body.foo}'}` arrives at `LogRunner.ask('echo', args, ctx)` already substituted to e.g. `'pay_123'` (or `'Bearer pay_123'` if embedded in a larger string); `echo` simply returns `args.value`, and the dispatcher's `remember` handling stores it under the row's key, same as any other extract step.

If a referenced path doesn't exist on the response (e.g. `${response.body.missingField}`), `extractJsonPath` throws during that `ctx.resolve()` call, the dispatcher's existing catch-all converts it to `step:failed`/`run:failed` — surfaced in the Results panel exactly like any other step failure, with the JSONPath error message.

**Icon rows:** `KeyValueRows.tsx`'s remove button's visible content changes from `Remove` to `✕`; its `aria-label` is unchanged. The add button's visible content changes from `Add {label} row` to `+ Add {label} row`; a new `aria-label="Add {label} row"` is added (previously the accessible name came entirely from text content — this pins it to the same value going forward regardless of future visual tweaks). New CSS (`packages/web/src/styles.css`): a borderless, muted-color icon-button class for remove (mirroring the existing `.flow-step-remove` precedent), the add button keeps its current full-width pill treatment.

## Testing

- `packages/engine`: new `context.test.ts` cases — `${var.path}` and `${var.path[0].more}` resolve via `extractJsonPath` (whole-match and embedded-in-string); a non-existent path throws (propagates, not swallowed); plain `${var}` (no dot/bracket) behavior is provably unchanged (existing test cases still pass verbatim).
- `packages/runner-log`: no change, so no new test — the existing `echo` action's existing test coverage already applies.
- `packages/web`:
  - `dsl.test.ts`: after-response rows produce the expected `log`/`echo` steps (`with: {value: row.value}`) in the right position; `HIDDEN_RESPONSE_VARIABLE` equals `'response'`; `rowsToRecord`'s `$now` resolves to a numeric-string timestamp, a non-`$now` value is untouched.
  - `KeyValueRows.test.tsx`: new cases asserting the `✕`/`+ Add {label} row` visible content while confirming existing accessible-name-based assertions still pass unmodified.
  - `RequestBuilder.test.tsx`: the two new tabs render, wire their respective `onChange` callbacks, and appear in the expected tab order for both REST and gRPC.
  - One `App.test.tsx` integration test: set a "Before invoke" row, reference it in the URL/body, set an "After response" row referencing `${response.body.<field>}`, run against a mocked SSE stream, and confirm the derived value appears correctly (e.g. surfaced via the existing Results/Context display).
