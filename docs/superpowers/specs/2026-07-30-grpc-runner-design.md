# gRPC Runner (Minimal Slice) — Design Spec

## Goal

Add a minimal, real, end-to-end gRPC calling capability to the API Runner: a Protocol toggle (REST | gRPC) in the Request Builder, a new `GrpcRunner` that can invoke a single unary RPC given an uploaded `.proto` file, proto-driven Service/Method suggestions, a "Paste grpcurl" import, and support for mixing REST and gRPC steps within one E2E Flow.

This is the first slice of the PRD's gRPC pillar (`docs/PRD_APIRunner.md`, "## gRPC" section) — scoped down from the fuller PRD vision the same way "Save as Reusable Step" and "Add to E2E Flow" were, but wide enough to cover the two import/discovery conveniences the PRD calls out as high-value for QC users.

## Scope

**In scope:**
- A `GrpcRunner` (new `packages/runner-grpc` package) implementing the engine's existing `Runner` interface, invoking a single unary RPC via `@grpc/grpc-js` + `@grpc/proto-loader`, loaded dynamically from a `.proto` file's content (no codegen).
- A Protocol toggle in the Request Builder. Selecting gRPC swaps Method/URL/Params/Headers/Auth/Body/Paste-cURL for Server Address/Proto/Service/Method/Message/Metadata/Paste-grpcurl. Extract and Questions stay shared and unchanged for both protocols.
- Plaintext (insecure) connections only.
- Proto-driven Service/Method suggestions: uploading a `.proto` introspects it and offers its services/methods as datalist suggestions (Service and Method stay free-text `<input>`s, matching the existing Actor/Task combobox pattern — not strict `<select>`s).
- "Paste grpcurl" — imports Server Address/Service/Method/Message/Metadata from a pasted `grpcurl` command (the `.proto` itself still needs to be uploaded separately).
- Numeric gRPC status codes for `status` extract/question actions (no name lookup table).
- Mixing REST and gRPC steps within one E2E Flow, via the engine's existing pluggable-runner dispatch — no flow-level changes needed.

**Out of scope (deliberately deferred):**
- TLS connections.
- A dynamic per-field message editor driven by the parsed message schema — Request Message is a JSON textarea, like Body.
- "Import Swagger".
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
- **Dynamic loading, no codegen**: `.proto` content (read client-side via `FileReader`, sent to the backend as raw text in the step's `with.proto`) is written to a temp file, loaded via `protoLoader.loadSync` + `grpc.loadPackageDefinition`.
- **Request message**: the Message tab's JSON text is `JSON.parse`'d and passed directly as the request object — `grpc-js`'s generated client accepts plain JS objects matching the message schema, no manual protobuf encoding needed (mirrors exactly how REST's Body JSON textarea works).
- **Response shape** stored via `ctx.remember`: `{ status: number; headers: Record<string, string>; body: unknown }` — same field names as `RestResponse`, so `ask('raw', ...)` and the existing `ResultsPanel`/`deriveResults` code work unchanged for gRPC responses. `status` is the raw numeric gRPC status code (`0` = OK); `headers` holds the response's trailing metadata, string-flattened; `body` is the decoded response message.
- **Extract/Question actions** (`status`/`header`/`jsonPath`/`raw`) reuse the exact same action names as REST — no new `SourceKind` type values.
- Wired into `packages/server/src/app.ts` alongside `LogRunner`/`RestRunner`: `registry.register(new GrpcRunner())`.

### Proto introspection (shared by the runner and the GUI)

A shared module, `packages/runner-grpc/src/proto.ts`:

```ts
export interface ServiceDefinition {
  service: string;   // bare name, no package prefix
  methods: string[];
}

export function loadPackageDefinition(protoContent: string): grpc.GrpcObject;
  // writes protoContent to a temp file, protoLoader.loadSync + grpc.loadPackageDefinition

export function listServices(protoContent: string): ServiceDefinition[];
  // recursively walks the loaded definition tree, collecting every node with
  // a `.service` property (grpc-js's convention for a generated service constructor)

export function findService(protoContent: string, serviceName: string): grpc.ServiceClientConstructor;
  // reuses the same walk as listServices, returns the first node whose bare
  // name matches `serviceName` exactly, or throws if none found
```

`GrpcRunner.interact` calls `findService` to locate the client constructor to invoke. A new endpoint reuses `listServices` for the GUI:

- **`POST /grpc/introspect`** (`packages/server/src/routes/grpc.ts`) — body `{ proto: string }` → `200 { services: ServiceDefinition[] }`, or `400 { error }` if the proto content fails to parse.
- Frontend wrapper `packages/web/src/grpcIntrospect.ts`: `introspectProto(protoContent: string): Promise<ServiceDefinition[] | undefined>` — `undefined` on any failure (network or parse error), matching the established never-throw fetch-wrapper convention.

**GUI behavior**: once a `.proto` file is uploaded (read via `FileReader`), the GUI calls `introspectProto` once and stores the result. Service becomes a `<datalist>`-backed text input (same combobox pattern as Actor/Task in `ScreenplayHeader.tsx`) suggesting the discovered service names. Method's datalist suggestions are filtered live to whichever service name is currently typed/selected. If introspection fails, an inline error is shown and both fields fall back to plain free-text entry with no suggestions — never a hard failure.

### "Paste grpcurl"

A real `grpcurl` command looks like:
```
grpcurl -plaintext -d '{"amount":100}' -H 'x-request-id: abc' localhost:50051 payment.PaymentService/CreatePayment
```

- `curl.ts`'s private tokenizer (`tokenize`/`joinContinuations`) is extracted into a shared `packages/web/src/shellTokenize.ts`, imported by both `curl.ts` and a new `packages/web/src/grpcurl.ts` — avoids duplicating the shell-argument tokenizer for a second, near-identical CLI syntax.
- `parseGrpcurl(input: string): GrpcurlParseResult` (`{ ok: true; serverAddress; service; method; message; metadata: KeyValueRow[] } | { ok: false; error }`):
  - Recognizes `-d`/`--data` (request message JSON), `-H`/`--header`/`--rpc-header` (metadata, same `key: value` splitting as cURL's `-H`).
  - The command's two trailing positional arguments are always `<address>` and `<package.Service/Method>` (grpcurl's fixed syntax) — the symbol is split on `/`, and everything before the last `.` in the service portion is dropped so only the bare service name remains (e.g. `payment.PaymentService` → `PaymentService`), consistent with `findService`'s bare-name lookup.
  - `-plaintext` and `-proto` are recognized but ignored — this app only supports plaintext, and the `.proto` file's actual contents can't come from a pasted command; it must still be uploaded via the Proto tab.
  - Any other flag is silently ignored, same policy as `parseCurl`.
- New component `packages/web/src/components/PasteGrpcurlPanel.tsx`, structurally identical to `CurlImport.tsx` (textarea + explicit "Import" button, never auto-parses on paste). On success, populates Server Address/Service/Method/Message/Metadata via callback (never the Proto tab). On failure, shows an inline error and leaves existing values untouched.
- New "Paste grpcurl" tab in the gRPC tab bar, positioned after Metadata (mirrors Paste cURL's position after Body in the REST tab bar).

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
- **Tab bar** — REST keeps its current tabs (Params, Headers, Auth, Body, Paste cURL, Extract, Questions) unchanged. gRPC shows: **Proto** (file input — "Browse" button, selected filename shown read-only, content read client-side via `FileReader`, triggers introspection), **Service** (datalist-backed text input), **Method** (datalist-backed text input, suggestions filtered to the current Service), **Message** (JSON textarea, styled identically to Body), **Metadata** (a `KeyValueRows`, reusing the exact component Headers already uses), **Paste grpcurl** (textarea + Import button), then **Extract** and **Questions** — shared, unchanged, at the end for both protocols.
- `SaveStepButton`/`LoadStepSelect`/`AddToFlowButton`/`FlowRunner` need no changes — they already treat a saved step as an opaque whole `FormState`; the new `protocol`/`grpc` fields ride along transparently.

## Testing Plan

- **A local fake gRPC server** for automated tests, mirroring `rest-flow.test.ts`'s `startFakePaymentApi` pattern — a tiny in-process server built with `@grpc/grpc-js` itself, implementing one trivial unary method against a small test `.proto` with at least two methods (to exercise Method-suggestion filtering), started/stopped per test.
- **`packages/runner-grpc/test/proto.test.ts`** — `listServices` correctly enumerates services/methods from a sample multi-service `.proto`; `findService` locates a service by bare name even when the proto declares a package prefix; both surface a clear error on malformed proto content.
- **`packages/runner-grpc/test/grpc-runner.test.ts`** — `interact('call', ...)` against the fake server returns the right decoded message; `ask('status'|'header'|'jsonPath'|'raw', ...)` read back correctly; a call to an unknown service/method surfaces a clear error; `ask` called before `interact` throws (mirrors `RestRunner`'s guard).
- **`packages/server/test/grpc-routes.test.ts`** — `POST /grpc/introspect` returns the right services/methods for a valid proto; `400` for invalid proto content.
- **`packages/web/test/grpcIntrospect.test.ts`** — `introspectProto` success and failure paths (never throws), mirroring `steps.test.ts`'s style.
- **`packages/web/test/shellTokenize.test.ts`** — the extracted tokenizer, covering the same cases already proven via `curl.test.ts` (quoting, line continuations) now tested directly against the shared module.
- **`packages/web/test/grpcurl.test.ts`** — `parseGrpcurl`: extracts address/service/method/message/metadata correctly; strips the package prefix from the service; ignores `-plaintext`/`-proto`/other unknown flags without failing; multi-line continuation support; error cases (doesn't start with `grpcurl`, missing address or symbol).
- **`packages/web/test/components/PasteGrpcurlPanel.test.tsx`** — valid import calls its callback with the right fields; invalid input shows an inline error and doesn't call it, mirroring `CurlImport.test.tsx`.
- **`packages/web/test/dsl.test.ts`** (extended) — `buildTaskSteps`/`buildFlowDefinition` with `protocol: 'grpc'` forms produce the right step shapes, all tagged `runner: 'grpc'`; a mixed flow (one REST form + one gRPC form) produces one task per form, each tagged with its own protocol's runner.
- **`packages/web/test/components/RequestBuilder.test.tsx`** (extended) — selecting gRPC swaps in the Proto/Service/Method/Message/Metadata/Paste-grpcurl tabs and removes Paste cURL; selecting REST restores the original tabs; Method's datalist suggestions change when a different Service is entered.
- **A new `packages/server/test/*.test.ts` end-to-end test** (mirroring `rest-flow.test.ts`) — a real `POST /runs` exercising a two-task flow (one REST task, one gRPC task) against a fake HTTP server and the fake gRPC server started together, proving a value extracted from the REST task correctly feeds into the gRPC task's request message via `${var}` through the real dispatcher.
- **Manual browser verification** (final task, as always) — build a gRPC step in the GUI against the fake gRPC server: upload its `.proto` and confirm Service/Method suggestions appear; paste a `grpcurl` command and confirm it populates the other fields; run the step, save it as a Reusable Step, add it to a flow alongside a REST step, and run the flow — confirming the checklist and expanded response render correctly for a gRPC task the same way they already do for REST.
