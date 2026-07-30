# gRPC Runner (Minimal Slice) — Design Spec

## Goal

Add a minimal, real, end-to-end gRPC calling capability to the API Runner: a Protocol toggle (REST | gRPC) in the Request Builder, a new `GrpcRunner` that can invoke a single unary RPC given an uploaded `.proto` file, and support for mixing REST and gRPC steps within one E2E Flow.

This is the first slice of the PRD's gRPC pillar (`docs/PRD_APIRunner.md`, "## gRPC" section) — deliberately scoped down the same way "Save as Reusable Step" and "Add to E2E Flow" were scoped down from their fuller PRD visions.

## Scope

**In scope:**
- A `GrpcRunner` (new `packages/runner-grpc` package) implementing the engine's existing `Runner` interface, invoking a single unary RPC via `@grpc/grpc-js` + `@grpc/proto-loader`, loaded dynamically from a `.proto` file's content (no codegen).
- A Protocol toggle in the Request Builder. Selecting gRPC swaps Method/URL/Params/Headers/Auth/Body/Paste-cURL for Server Address/Proto/Service/Method/Message/Metadata. Extract and Questions stay shared and unchanged for both protocols.
- Plaintext (insecure) connections only.
- Numeric gRPC status codes for `status` extract/question actions (no name lookup table).
- Mixing REST and gRPC steps within one E2E Flow, via the engine's existing pluggable-runner dispatch — no flow-level changes needed.

**Out of scope (deliberately deferred):**
- TLS connections.
- Proto-driven Service/Method dropdowns — Service and Method are free-text fields for now.
- A dynamic per-field message editor driven by the parsed message schema — Request Message is a JSON textarea, like Body.
- "Paste grpcurl" and "Import Swagger".
- Streaming RPCs (unary only).
- A gRPC status-code-to-name lookup (e.g. `OK`, `NOT_FOUND`) — raw numeric codes only.
- Relabeling "header" to "metadata" in the Extract/Questions source-kind dropdown when gRPC is selected — it stays labeled "header" for both protocols in this slice.

## Architecture

### `GrpcRunner` (new `packages/runner-grpc` package)

Mirrors `RestRunner`'s exact shape (`packages/runner-api/src/rest-runner.ts`) — same `Runner` interface (verified generic/protocol-agnostic in `packages/engine/src/runner.ts`, requiring no engine changes), same "remember the last response, `ask` reads back from it" pattern:

```ts
export class GrpcRunner implements Runner {
  name = 'grpc';

  async interact(action: string, args: Record<string, unknown>, ctx: RunContext): Promise<void> {
    // action === 'call': load the proto, invoke the unary RPC, remember the response
  }

  async ask(action: string, args: Record<string, unknown>, ctx: RunContext): Promise<unknown> {
    // 'status' -> numeric gRPC status code
    // 'header'  -> a metadata/trailer entry (args.name)
    // 'jsonPath' -> extract from the decoded response message
    // 'raw' -> the whole response
  }
}
```

- **New dependencies**: `@grpc/grpc-js` + `@grpc/proto-loader` — the first new runtime dependencies added since `ajv`. Deliberate and expected for a genuinely new protocol.
- **Dynamic loading, no codegen**: the `.proto` content (read client-side via `FileReader`, sent to the backend as raw text in the step's `with.proto`) is written to a temp file, loaded via `protoLoader.loadSync` + `grpc.loadPackageDefinition`. The resulting package/service tree is searched recursively for a service matching the given Service name (case-sensitive exact match on the bare name) — the user does not need to type the fully-qualified `package.Service` path.
- **Request message**: the Message tab's JSON text is `JSON.parse`'d and passed directly as the request object — `grpc-js`'s generated client accepts plain JS objects matching the message schema, no manual protobuf encoding needed (mirrors exactly how REST's Body JSON textarea works).
- **Response shape** stored via `ctx.remember`: `{ status: number; headers: Record<string, string>; body: unknown }` — same field names as `RestResponse`, so `ask('raw', ...)` and the existing `ResultsPanel`/`deriveResults` code work unchanged for gRPC responses. `status` is the raw numeric gRPC status code (`0` = OK); `headers` holds the response's trailing metadata, string-flattened; `body` is the decoded response message.
- **Extract/Question actions** (`status`/`header`/`jsonPath`/`raw`) reuse the exact same action names as REST — no new `SourceKind` type values.
- Wired into `packages/server/src/app.ts` alongside `LogRunner`/`RestRunner`: `registry.register(new GrpcRunner())`.

### `FormState` / `dsl.ts` — protocol branching

`FormState` gains two new, always-present fields (matching the existing convention that every field has a sensible default rather than being optional):

```ts
export interface FormState {
  // ...existing fields unchanged...
  protocol: 'rest' | 'grpc'; // defaults to 'rest'
  grpc: {
    protoContent: string;
    protoFilename: string;
    serverAddress: string;
    service: string;
    method: string;
    requestMessage: string; // JSON text, same convention as `body`
    metadata: KeyValueRow[]; // same shape as `headers`
  };
}
```

`buildTaskSteps(form)` in `dsl.ts` branches only on how the **interaction** step is built — the extract/question steps stay identical in shape, just tagged with the right `runner`:

```ts
function buildInteractionStep(form: FormState): Step {
  if (form.protocol === 'grpc') {
    return {
      type: 'interaction',
      runner: 'grpc',
      action: 'call',
      with: {
        proto: form.grpc.protoContent,
        serverAddress: form.grpc.serverAddress,
        service: form.grpc.service,
        method: form.grpc.method,
        message: form.grpc.requestMessage.trim() === '' ? {} : JSON.parse(form.grpc.requestMessage),
        metadata: rowsToRecord(form.grpc.metadata),
      },
    };
  }
  return { type: 'interaction', runner: 'rest', action: 'request', with: /* existing REST logic, unchanged */ };
}

export function buildTaskSteps(form: FormState): Step[] {
  const runner = form.protocol === 'grpc' ? 'grpc' : 'rest';
  return [
    buildInteractionStep(form),
    { type: 'extract', runner, action: 'raw', remember: HIDDEN_RESPONSE_VARIABLE },
    ...form.extracts.map((row) => ({
      type: 'extract',
      runner,
      ...sourceToStepFields(row.source, row.path),
      remember: row.rememberAs,
    })),
    ...form.questions.map((row) => ({
      type: 'question',
      runner,
      ...sourceToStepFields(row.source, row.path),
      expect: { equals: parseExpected(row.expected) },
    })),
  ];
}
```

Because `buildFlowDefinition` already calls `buildTaskSteps` once per saved step, a flow mixing REST and gRPC steps works automatically — each task's `runner` tag routes its steps to the right runner via the engine's existing dispatcher.

`isFormValid` (in `App.tsx`) gains a parallel branch: for `protocol === 'grpc'`, require `serverAddress`/`service`/`method`/`protoContent` non-empty and `requestMessage` to be valid JSON (or blank) — mirroring the existing `isBodyValid` check.

### Request Builder UI

The overall shape (target row → tabs → Extract/Questions) stays the same for both protocols:

- **Target row**: a new "Protocol" `<select>` (REST | gRPC) sits next to Method+URL. Selecting gRPC replaces Method+URL with a single "Server Address" text field (e.g. `${grpcHost}:50051`, using the same `${var}` interpolation REST's URL already supports).
- **Tab bar** — REST keeps its current tabs (Params, Headers, Auth, Body, Paste cURL, Extract, Questions) unchanged. gRPC shows: **Proto** (file input — "Browse" button, selected filename shown read-only, content read client-side via `FileReader`), **Service** (text input), **Method** (text input), **Message** (JSON textarea, styled identically to Body), **Metadata** (a `KeyValueRows`, reusing the exact component Headers already uses), then **Extract** and **Questions** — shared, unchanged, at the end for both protocols.
- `SaveStepButton`/`LoadStepSelect`/`AddToFlowButton`/`FlowRunner` need no changes — they already treat a saved step as an opaque whole `FormState`; the new `protocol`/`grpc` fields ride along transparently.

## Testing Plan

- **A local fake gRPC server** for automated tests, mirroring `rest-flow.test.ts`'s `startFakePaymentApi` pattern — a tiny in-process server built with `@grpc/grpc-js` itself, implementing one trivial unary method against a small test `.proto`, started/stopped per test.
- **`packages/runner-grpc/test/grpc-runner.test.ts`** — `interact('call', ...)` against the fake server returns the right decoded message; `ask('status'|'header'|'jsonPath'|'raw', ...)` read back correctly; a call to an unknown service/method surfaces a clear error; `ask` called before `interact` throws (mirrors `RestRunner`'s guard).
- **`packages/web/test/dsl.test.ts`** (extended) — `buildTaskSteps`/`buildFlowDefinition` with `protocol: 'grpc'` forms produce the right step shapes, all tagged `runner: 'grpc'`; a mixed flow (one REST form + one gRPC form) produces one task per form, each tagged with its own protocol's runner.
- **`packages/web/test/components/RequestBuilder.test.tsx`** (extended) — selecting gRPC swaps in the Proto/Service/Method/Message/Metadata tabs and removes Paste cURL; selecting REST restores the original tabs.
- **A new `packages/server/test/*.test.ts` end-to-end test** (mirroring `rest-flow.test.ts`) — a real `POST /runs` exercising a two-task flow (one REST task, one gRPC task) against a fake HTTP server and the fake gRPC server started together, proving a value extracted from the REST task correctly feeds into the gRPC task's request message via `${var}` through the real dispatcher.
- **Manual browser verification** (final task, as always) — build a gRPC step in the GUI against the fake gRPC server, upload its `.proto`, run it, save it as a Reusable Step, add it to a flow alongside a REST step, and run the flow — confirming the checklist and expanded response render correctly for a gRPC task the same way they already do for REST.
