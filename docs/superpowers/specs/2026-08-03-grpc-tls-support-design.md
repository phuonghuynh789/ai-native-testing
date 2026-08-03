# gRPC TLS Support — Design Spec

## Goal

Add TLS support to the gRPC Runner (`docs/superpowers/specs/2026-07-30-grpc-runner-design.md`), which today only supports plaintext (insecure) connections. This was found via real dogfooding: pasting a real `grpcurl` command against an internal ZaloPay endpoint on `:443` failed with gRPC status `14` (`UNAVAILABLE`) because `GrpcRunner` unconditionally uses `grpc.credentials.createInsecure()`, and a plaintext client cannot complete a handshake with a TLS-only server. Real production and internal gRPC services are almost always TLS — this was an explicit, deliberate limitation of the "minimal slice," not a defect in what was built, but it blocks the tool's real-world use case.

## Scope

**In scope:**
- Two independent booleans on a gRPC step: `secure` (TLS on/off) and `skipCertVerification` (skip full chain/hostname validation when TLS is on — only meaningful together with `secure: true`).
- `GrpcRunner` selecting the correct `@grpc/grpc-js` credentials for all three resulting states: plaintext, TLS with normal verification, TLS with verification skipped.
- A "Secure (TLS)" + "Skip certificate verification" pair of checkboxes in the Request Builder's gRPC mode, next to Server Address.
- "Paste grpcurl" mapping `-plaintext`/`-insecure` (and their absence) onto these two fields, matching real `grpcurl`'s own semantics.
- New forms default to `secure: true` (matching real `grpcurl`'s default and real-world servers). Existing saved steps, which predate these fields, load with `secure: undefined` — this correctly falls through to plaintext behavior (`!secure` is truthy for `undefined`), i.e. exactly what that step's data always meant. No explicit migration is needed.

**Out of scope (deliberately deferred):**
- Custom CA certificate upload/selection.
- Client certificates (mTLS).
- Any `grpcurl` flags beyond `-plaintext`/`-insecure` (e.g. `-cacert`, `-cert`, `-key`, `-authority`) — these continue to be silently ignored, per the existing "unknown flags never fail parsing" rule from the original gRPC Runner spec.
- Auto-detecting TLS from the address/port — the toggle is always explicit.

## Data Model

`GrpcFormState` (`packages/web/src/types.ts`) gains:

```ts
export interface GrpcFormState {
  // ...existing fields unchanged...
  secure: boolean;
  skipCertVerification: boolean;
}
```

`dsl.ts`'s `buildInteractionStep` (gRPC branch) adds both fields to the `with` object it already builds, alongside `proto`/`serverAddress`/`service`/`method`/`message`/`metadata`:

```ts
with: {
  // ...existing fields...
  secure: form.grpc.secure,
  skipCertVerification: form.grpc.skipCertVerification,
}
```

`GrpcCallArgs` (`packages/runner-grpc/src/grpc-runner.ts`) gains the matching two optional fields (optional because a step's `with` payload is attacker/user-suppliable JSON at the dispatcher boundary, same treatment as every other field there today).

## `GrpcRunner` Credential Selection

In `callUnary`, replace the unconditional `grpc.credentials.createInsecure()` with:

```ts
function selectCredentials(args: GrpcCallArgs): grpc.ChannelCredentials {
  if (!args.secure) {
    return grpc.credentials.createInsecure();
  }
  if (args.skipCertVerification) {
    return grpc.credentials.createSsl(null, null, null, { rejectUnauthorized: false });
  }
  return grpc.credentials.createSsl();
}
```

`VerifyOptions.rejectUnauthorized` is a real, documented option on `@grpc/grpc-js`'s `createSsl` (verified against the installed `1.14.4` type declarations, `channel-credentials.d.ts`) — this is the library's supported mechanism for what `grpcurl -insecure` does, not a workaround. Everything else in `callUnary` (deadline, metadata capture, `client.close()` in `finally`) is unchanged.

## UI

In `RequestBuilder.tsx`'s gRPC mode, next to the Server Address field: two checkboxes, "Secure (TLS)" (bound to `grpc.secure`) and "Skip certificate verification" (bound to `grpc.skipCertVerification`, `disabled` when `!grpc.secure`, and visually de-emphasized in that state). Both flow through `onGrpcChange` the same way every other `grpc.*` field does today.

## `parseGrpcurl` Changes

Today, `-plaintext`/`--plaintext` is recognized and silently ignored (everything was plaintext). New behavior:

| Pasted command contains | Resulting fields |
|---|---|
| `-plaintext` (or `--plaintext`) | `secure: false`, `skipCertVerification: false` |
| `-insecure` (or `--insecure`), no `-plaintext` | `secure: true`, `skipCertVerification: true` |
| neither | `secure: true`, `skipCertVerification: false` (matches real `grpcurl`'s own default) |
| both `-plaintext` and `-insecure` | `-plaintext` wins (transport choice is more fundamental than cert verification) — a documented tie-break, not a parse error, consistent with this parser's existing "never fail on flags" philosophy |

`GrpcurlParseResult` and `PasteGrpcurlPanelResult` both gain `secure`/`skipCertVerification` fields, threaded through exactly like `serverAddress`/`service`/`method` already are.

## Testing

`packages/runner-grpc/src/testing.ts` gains a second helper, `startFakeSecurePaymentGrpcServer()`, bound via `grpc.ServerCredentials.createSsl(...)` using a **static, pre-generated self-signed cert/key pair** committed as fixtures at `packages/runner-grpc/test/fixtures/localhost-cert.pem` / `localhost-key.pem` (CN=`localhost`, SANs for `localhost` and `127.0.0.1`, ~10-year validity, generated once via `openssl req -x509 -newkey rsa:2048 -nodes -keyout ... -out ... -days 3650`). No new runtime or dev dependency.

New `GrpcRunner` tests cover all three credential paths against real servers (not mocks):
- plaintext call against the existing plaintext fake server (regression coverage, unchanged)
- secure call with normal verification against the TLS fake server, passing the fixture cert as a trusted root — proves TLS-with-verification actually works
- secure call with `skipCertVerification: true` against the TLS fake server *without* trusting the fixture cert — proves `rejectUnauthorized: false` is what makes an otherwise-untrusted certificate work (the scenario a real internal-CA server like the ZaloPay example needs)

`RequestBuilder.test.tsx` gets tests for the two checkboxes' default state and the disabled-when-plaintext behavior. `grpcurl.test.ts` gets tests for the four-way `-plaintext`/`-insecure`/neither/both mapping in the table above.
