# gRPC TLS Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add TLS support to the gRPC Runner: a "Secure (TLS)" + "Skip certificate verification" pair of options on a gRPC step, correctly wired through `GrpcRunner`'s credential selection, the Request Builder UI, and `grpcurl` import.

**Architecture:** Two new booleans (`secure`, `skipCertVerification`) travel the same path every other gRPC field already does — `GrpcFormState` → `dsl.ts`'s `with` object → `GrpcCallArgs` → `GrpcRunner.callUnary`'s credential selection — with no new plumbing needed anywhere else. A new TLS-enabled fake test server (bound and addressed via the `localhost` hostname, never an IP literal — Node's TLS layer rejects setting SNI to an IP address) lets tests exercise all three real credential paths (plaintext, TLS-verified, TLS-skip-verification) against a real server, not mocks.

**Tech Stack:** TypeScript, `@grpc/grpc-js` (`ChannelCredentials.createSsl`/`ServerCredentials.createSsl`, both already a direct dependency), Vitest, React.

Spec: [`docs/superpowers/specs/2026-08-03-grpc-tls-support-design.md`](../specs/2026-08-03-grpc-tls-support-design.md)

## Global Constraints

- New gRPC forms default to `secure: true` (matches real `grpcurl`'s own default). Existing saved steps, which predate these fields, load with `secure: undefined`, which correctly falls through to plaintext behavior (`!undefined` is truthy) — no explicit migration code.
- "Skip certificate verification" is only meaningful when `secure` is on; its checkbox is `disabled` when `secure` is off.
- `parseGrpcurl` maps `-plaintext`/`-insecure` exactly as: `-plaintext` present → `secure: false` (wins over `-insecure` if both are present); `-insecure` present without `-plaintext` → `secure: true, skipCertVerification: true`; neither → `secure: true, skipCertVerification: false`. Never a parse error, regardless of combination.
- Custom CA certificate upload, client certificates (mTLS), and any `grpcurl` flags beyond `-plaintext`/`-insecure` (e.g. `-cacert`, `-cert`, `-key`, `-authority`) are out of scope — those continue to be silently ignored, per the existing "unknown flags never fail parsing" rule.
- No auto-detection of TLS from port or address — the toggle is always explicit.
- `grpc.credentials.createSsl(null, null, null, { rejectUnauthorized: false })` is the real, documented `@grpc/grpc-js` mechanism for skipping certificate verification — not a workaround.

---

### Task 1: TLS test fixtures + `startFakeSecurePaymentGrpcServer`

**Files:**
- Create: `packages/runner-grpc/test/fixtures/localhost-cert.pem`
- Create: `packages/runner-grpc/test/fixtures/localhost-key.pem`
- Modify: `packages/runner-grpc/src/testing.ts`
- Modify: `packages/runner-grpc/src/index.ts`

**Interfaces:**
- Produces: `startFakeSecurePaymentGrpcServer(): Promise<FakeSecureGrpcServer>` (`FakeSecureGrpcServer` extends `FakeGrpcServer` with `cert: Buffer`). Consumed by `GrpcRunner` tests (Task 2).

- [ ] **Step 1: Add the static self-signed test certificate and key**

These are a pre-generated, self-signed cert/key pair for `CN=localhost` with Subject Alternative Names for both `localhost` and `127.0.0.1`, valid 10 years (until 2036-07-31). Generated once via `openssl req -x509 -newkey rsa:2048 -nodes -keyout localhost-key.pem -out localhost-cert.pem -days 3650 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"` — use the exact content below, don't regenerate (a different key each time is fine functionally, but there's no reason to; this one is already verified working end-to-end against `@grpc/grpc-js` 1.14.4).

Create `packages/runner-grpc/test/fixtures/localhost-cert.pem`:

```
-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIUXC/aa6w7MIBorR6b1A8Oi3KgBMcwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDgwMzE0MjcwMVoXDTM2MDcz
MTE0MjcwMVowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEA7diGDMemEtyVTbDT/qlAY65jFfFEu+0pvCIl9O91jnyb
Lgx4OaK3AYSiE0wJGzfsaeUehai23H6w6ac6cT3TVsSG1Mv+0ard2GWi6+zaV2UW
E1iKojqgdA4TRePTLRwmiNvvOKWyqlKSH3oLDMer7aZnjtd17HOF/Z2kQ9Ax97oB
pE1dsYn58m0F/4G+ZipLb42ZjqgHmCFgaFsSQVnt/P7pq6BeRgPikvL4GfrEQ88D
T0/7lRwmMrpkA7/Y/XQzv+D8SSkEtTHlHYwQXLlW+ToA8jx/pnjmqcXAmazhfTF9
nlK+ha5LgAzCPo46yzEPaedmhmPSmQRTaOaJ+2sOowIDAQABo28wbTAdBgNVHQ4E
FgQUGFYrGfw7+SPiutySv17xnI0R2hwwHwYDVR0jBBgwFoAUGFYrGfw7+SPiutyS
v17xnI0R2hwwDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2NhbGhvc3SH
BH8AAAEwDQYJKoZIhvcNAQELBQADggEBABkF9eMM1iJ53LXTyK8C4l5r3FFB0xI8
UP2TyxINL+VUolXRvuGGkYfcMSkprZiwxqSvxvyjPkJKiaFxtayiknpVf7qryU41
UNc/CLVcC4d3BQYet6KcuOddmVVWrBlKO01DOIm3luQ9wKhWzFV3hZQ0m5qFWXuU
8cE57T6e8IwDtUFUz4qnwbwgUqGaFjw2RYjKPCVLNskfKP0rfiG3SVNco/z99Nsh
HUYa2zndvYpq6ppg4OkYPgvETQQh5s0VFNoAzujDh8J7Rf6tXS2diV1gdQl+95Xu
v2Pun2IXcWQfGqzr6YaiwcCeUf2rZpF1Ic7DPucUMuqXN82Qe8mKptU=
-----END CERTIFICATE-----
```

Create `packages/runner-grpc/test/fixtures/localhost-key.pem`:

```
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDt2IYMx6YS3JVN
sNP+qUBjrmMV8US77Sm8IiX073WOfJsuDHg5orcBhKITTAkbN+xp5R6FqLbcfrDp
pzpxPdNWxIbUy/7Rqt3YZaLr7NpXZRYTWIqiOqB0DhNF49MtHCaI2+84pbKqUpIf
egsMx6vtpmeO13Xsc4X9naRD0DH3ugGkTV2xifnybQX/gb5mKktvjZmOqAeYIWBo
WxJBWe38/umroF5GA+KS8vgZ+sRDzwNPT/uVHCYyumQDv9j9dDO/4PxJKQS1MeUd
jBBcuVb5OgDyPH+meOapxcCZrOF9MX2eUr6FrkuADMI+jjrLMQ9p52aGY9KZBFNo
5on7aw6jAgMBAAECggEASxuWjT+YtpkYvt1pvKAG+NNvb9TuPygQB1yDPvtFVLcN
q/d9GbpD70NKiSx4LbO1wOT9A/k4sZ2CUW6hGnSLIfnSmC1JLT23a6gA0F7Nvk5q
L7bEpKE93Rg6xtXAcJzUoGBPhURyDK4hfbYk+iatqNDlH+rzTrVWaTXYUx/SP6dO
BIjtOHvAN0wnLQVs3VGSUl/I8IkGmRnOzML+0PiTXqePPq0A206G72e+rzB3RJC5
vh3cRqQdZ6a1dvivdK0+vQgIAvX0JuxHfQRN+UfBhM26ugl8irAX4zwiTzKrrNbC
9361QDi55hi7YwvqKmJLPyp/7BlC1KYAu45G84D/+QKBgQD+lygxP2w+dndzdYkB
S/yGr7H4UhH8y4yvThrAq4vjqzTbtCsOdSuhdBO6PVI1ZjkqwydAGOCcReMHpaeg
zY6HfekA+2szzX30+wixxGU8luWbWvPylhhl3EpmGqzoR9N5cN1oWMB2BgIb3fmZ
0ecYx2REws0Q7doVvPahbYwSKwKBgQDvKaI2Aj5hTSKGVX3IrWrysqhyHBwJbK26
xl+388LkEBs23VYVbrjxfZeDl29ZHK8YWM3wZ0eH3+nSRLji0xVyPV602fKlbs0J
m1m6ADt6KbwOQ0Vgj7KzJNM0G76bS+l9GIOYk+IsgDATN04M0QgivW6gtua/OHL9
STBH7ahRaQKBgHi0cfnneAqlYDz9nNdgj3nMEzUItD6Gw0zaWxS+QLTQl18TLNbN
9sG1pyTFrhRjQvdjT1i0csmk2N7nS3KSAuF6cN5mVY1aAD4GRzkBRH5VjMb7eG2r
fCXPK/b87r2yUDFjsZWnfph2gMl1lMG5Izg8UO3I7jD4lE16KfSfW6nBAoGAfklv
vDEnG14Nsv2Fs+fOp2UriUXKkDdw7UU+2fW/nYnbtPbfM+YJhosY7IWUaGu7EZIi
/KSsotTbtQpQzoVDt9UsIzdK54xAfKgpkwv4XCOZh7aB9eErLWlulP9pgLtvCX1e
T70XGwR9Xkg/0Ii4UQ/SUM8DvUljftecxP57eLECgYEAhHOBhJ6ObNMioF9CXVWr
OvuRHlKn2WFDsDwTadM4umU41TcQT3A7BnVjqneRpNr2bg4M+GAjfwZojT0okaww
t7N6P/YdOfKZUq1yxTwRopJ3RnnmTB4yAA8lmwtA9FmOvqh2gofvE7v7RlcJQOIY
uyUU8xqHkKm+QFE7AoLEX8k=
-----END PRIVATE KEY-----
```

- [ ] **Step 2: Refactor `testing.ts` to share proto-loading and add the secure server**

Replace the entire contents of `packages/runner-grpc/src/testing.ts` with:

```ts
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const FAKE_PAYMENT_PROTO = `
syntax = "proto3";
package test;

message CreatePaymentRequest {
  string amount = 1;
  string customerId = 2;
}

message CreatePaymentResponse {
  string paymentId = 1;
  string status = 2;
}

message GetPaymentRequest {
  string paymentId = 1;
}

message GetPaymentResponse {
  string status = 1;
}

service PaymentService {
  rpc CreatePayment (CreatePaymentRequest) returns (CreatePaymentResponse);
  rpc GetPayment (GetPaymentRequest) returns (GetPaymentResponse);
}
`;

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');

export interface FakeGrpcServer {
  address: string;
  proto: string;
  close: () => Promise<void>;
}

export interface FakeSecureGrpcServer extends FakeGrpcServer {
  cert: Buffer;
}

function paymentServiceImplementation() {
  return {
    CreatePayment: (
      call: grpc.ServerUnaryCall<{ amount: string; customerId: string }, unknown>,
      callback: grpc.sendUnaryData<{ paymentId: string; status: string }>
    ) => {
      const initialMetadata = new grpc.Metadata();
      initialMetadata.set('x-request-id', 'req-abc-123');
      call.sendMetadata(initialMetadata);

      const trailer = new grpc.Metadata();
      trailer.set('x-trailer-only', 'trailer-value');
      callback(null, { paymentId: 'pay-123', status: 'CREATED' }, trailer);
    },
    GetPayment: (
      call: grpc.ServerUnaryCall<{ paymentId: string }, unknown>,
      callback: grpc.sendUnaryData<{ status: string }>
    ) => {
      callback(null, { status: 'SUCCESS' });
    },
  };
}

function loadPaymentServiceDefinition(): { dir: string; serviceDefinition: grpc.ServiceDefinition } {
  const dir = mkdtempSync(join(tmpdir(), 'fake-grpc-'));
  const protoPath = join(dir, 'test.proto');
  writeFileSync(protoPath, FAKE_PAYMENT_PROTO);

  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const packageObject = grpc.loadPackageDefinition(packageDefinition) as unknown as {
    test: { PaymentService: { service: grpc.ServiceDefinition } };
  };
  return { dir, serviceDefinition: packageObject.test.PaymentService.service };
}

export async function startFakePaymentGrpcServer(): Promise<FakeGrpcServer> {
  const { dir, serviceDefinition } = loadPaymentServiceDefinition();

  const server = new grpc.Server();
  server.addService(serviceDefinition, paymentServiceImplementation());

  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(boundPort);
    });
  });

  return {
    address: `127.0.0.1:${port}`,
    proto: FAKE_PAYMENT_PROTO,
    close: () =>
      new Promise<void>((resolve) => {
        server.tryShutdown(() => {
          rmSync(dir, { recursive: true, force: true });
          resolve();
        });
      }),
  };
}

export async function startFakeSecurePaymentGrpcServer(): Promise<FakeSecureGrpcServer> {
  const { dir, serviceDefinition } = loadPaymentServiceDefinition();
  const cert = readFileSync(join(FIXTURES_DIR, 'localhost-cert.pem'));
  const key = readFileSync(join(FIXTURES_DIR, 'localhost-key.pem'));

  const server = new grpc.Server();
  server.addService(serviceDefinition, paymentServiceImplementation());

  // Bound and addressed via the "localhost" hostname, never an IP literal:
  // Node's TLS layer refuses to set the SNI servername to an IP address
  // (RFC 6066), so a client connecting to "127.0.0.1:<port>" over TLS would
  // always fail the handshake regardless of certificate validity. Real-world
  // TLS gRPC targets are hostnames for the same reason.
  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync(
      'localhost:0',
      grpc.ServerCredentials.createSsl(null, [{ private_key: key, cert_chain: cert }]),
      (err, boundPort) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(boundPort);
      }
    );
  });

  return {
    address: `localhost:${port}`,
    proto: FAKE_PAYMENT_PROTO,
    cert,
    close: () =>
      new Promise<void>((resolve) => {
        server.tryShutdown(() => {
          rmSync(dir, { recursive: true, force: true });
          resolve();
        });
      }),
  };
}
```

- [ ] **Step 3: Export the new helper from `index.ts`**

In `packages/runner-grpc/src/index.ts`, change:

```ts
export { GrpcRunner } from './grpc-runner.js';
export { listServices, findService, type ServiceDefinition } from './proto.js';
export { startFakePaymentGrpcServer, FAKE_PAYMENT_PROTO, type FakeGrpcServer } from './testing.js';
```

to:

```ts
export { GrpcRunner } from './grpc-runner.js';
export { listServices, findService, type ServiceDefinition } from './proto.js';
export {
  startFakePaymentGrpcServer,
  startFakeSecurePaymentGrpcServer,
  FAKE_PAYMENT_PROTO,
  type FakeGrpcServer,
  type FakeSecureGrpcServer,
} from './testing.js';
```

- [ ] **Step 4: Run the existing tests to verify the refactor didn't break anything**

Run: `pnpm --filter @ai-native-testing/runner-grpc test`
Expected: PASS (all existing tests — this step is a pure refactor plus one new unused-so-far export, no behavior change to `startFakePaymentGrpcServer`).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/runner-grpc typecheck`
Expected: no errors.

```bash
git add packages/runner-grpc/test/fixtures/localhost-cert.pem packages/runner-grpc/test/fixtures/localhost-key.pem packages/runner-grpc/src/testing.ts packages/runner-grpc/src/index.ts
git commit -m "feat(runner-grpc): add a TLS-enabled fake test server and cert fixtures"
```

---

### Task 2: `GrpcRunner` credential selection

**Files:**
- Modify: `packages/runner-grpc/src/grpc-runner.ts`
- Modify: `packages/runner-grpc/test/grpc-runner.test.ts`

**Interfaces:**
- Consumes: `startFakeSecurePaymentGrpcServer` (Task 1).
- Produces: `GrpcCallArgs` gains `secure?: boolean` and `skipCertVerification?: boolean`. Consumed by `dsl.ts` (Task 3) via the `with` object on a gRPC interaction step.

- [ ] **Step 1: Write failing tests for the three credential paths**

In `packages/runner-grpc/test/grpc-runner.test.ts`, change the import line:

```ts
import { startFakePaymentGrpcServer, type FakeGrpcServer } from '../src/testing.js';
```

to:

```ts
import {
  startFakePaymentGrpcServer,
  startFakeSecurePaymentGrpcServer,
  type FakeGrpcServer,
  type FakeSecureGrpcServer,
} from '../src/testing.js';
```

Then add this block at the very end of the file, right before the final closing `});` of the `describe('GrpcRunner', ...)` block:

```ts

  it('makes a plaintext call by default when secure is not set (backward compatible)', async () => {
    server = await startFakePaymentGrpcServer();
    const runner = new GrpcRunner();
    const ctx = new RunContext();

    await runner.interact(
      'call',
      {
        proto: server.proto,
        serverAddress: server.address,
        service: 'PaymentService',
        method: 'CreatePayment',
        message: { amount: '100', customerId: 'CUS001' },
      },
      ctx
    );

    expect(await runner.ask('status', {}, ctx)).toBe(0);
  });

  it('fails over TLS when the server cert is not trusted and verification is on', async () => {
    // GrpcRunner has no way to supply a custom trusted root cert in this
    // slice (out of scope — see design spec), so a "secure: true" call with
    // verification on can never succeed against the self-signed fake secure
    // server. This proves createSsl()'s default verification is genuinely
    // active — the untrusted cert is correctly rejected, not silently
    // accepted — which is exactly what the next test's skipCertVerification
    // path is contrasted against.
    const secureServer: FakeSecureGrpcServer = await startFakeSecurePaymentGrpcServer();
    server = secureServer;
    const runner = new GrpcRunner();
    const ctx = new RunContext();

    await expect(
      runner.interact(
        'call',
        {
          proto: secureServer.proto,
          serverAddress: secureServer.address,
          service: 'PaymentService',
          method: 'CreatePayment',
          message: { amount: '100', customerId: 'CUS001' },
          secure: true,
        },
        ctx
      )
    ).resolves.toBeUndefined();

    expect(await runner.ask('status', {}, ctx)).not.toBe(0);
  });

  it('succeeds over TLS with an untrusted cert when skipCertVerification is true', async () => {
    const secureServer: FakeSecureGrpcServer = await startFakeSecurePaymentGrpcServer();
    server = secureServer;
    const runner = new GrpcRunner();
    const ctx = new RunContext();

    await runner.interact(
      'call',
      {
        proto: secureServer.proto,
        serverAddress: secureServer.address,
        service: 'PaymentService',
        method: 'CreatePayment',
        message: { amount: '100', customerId: 'CUS001' },
        secure: true,
        skipCertVerification: true,
      },
      ctx
    );

    expect(await runner.ask('status', {}, ctx)).toBe(0);
    expect(await runner.ask('raw', {}, ctx)).toMatchObject({
      status: 0,
      body: { paymentId: 'pay-123', status: 'CREATED' },
    });
  });
```

- [ ] **Step 2: Run the tests to verify the new ones fail or misbehave**

Run: `pnpm --filter @ai-native-testing/runner-grpc test`
Expected: the "succeeds over TLS with an untrusted cert" test FAILS or hangs — `GrpcRunner` currently ignores `secure`/`skipCertVerification` entirely and always calls `grpc.credentials.createInsecure()`, so a plaintext client can't complete a handshake with the TLS-only fake secure server. The "not trusted... fails as expected" test may pass vacuously or fail depending on how an insecure client behaves against a TLS listener — either way, this step just confirms the current code doesn't yet branch on these fields.

- [ ] **Step 3: Implement credential selection in `grpc-runner.ts`**

In `packages/runner-grpc/src/grpc-runner.ts`, change:

```ts
interface GrpcCallArgs {
  proto: string;
  serverAddress: string;
  service: string;
  method: string;
  message: unknown;
  metadata?: Record<string, string>;
}
```

to:

```ts
interface GrpcCallArgs {
  proto: string;
  serverAddress: string;
  service: string;
  method: string;
  message: unknown;
  metadata?: Record<string, string>;
  secure?: boolean;
  skipCertVerification?: boolean;
}

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

Then change:

```ts
    const ServiceCtor = findService(args.proto, args.service);
    const client = new ServiceCtor(args.serverAddress, grpc.credentials.createInsecure());
```

to:

```ts
    const ServiceCtor = findService(args.proto, args.service);
    const client = new ServiceCtor(args.serverAddress, selectCredentials(args));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/runner-grpc test`
Expected: PASS — all 10 existing tests plus the 3 new ones (13 total).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/runner-grpc typecheck`
Expected: no errors.

```bash
git add packages/runner-grpc/src/grpc-runner.ts packages/runner-grpc/test/grpc-runner.test.ts
git commit -m "feat(runner-grpc): support secure (TLS) and skip-cert-verification connections"
```

---

### Task 3: `GrpcFormState` widening + `dsl.ts` wiring

**Files:**
- Modify: `packages/web/src/types.ts`
- Modify: `packages/web/src/dsl.ts`
- Modify: `packages/web/test/dsl.test.ts`
- Modify: `packages/web/test/steps.test.ts`
- Modify: `packages/web/test/components/RunButton.test.tsx`
- Modify: `packages/web/test/components/FlowRunner.test.tsx`
- Modify: `packages/web/test/components/SaveStepButton.test.tsx`
- Modify: `packages/web/test/components/LoadStepSelect.test.tsx`
- Modify: `packages/web/test/components/RequestBuilder.test.tsx` (`blankGrpc` helper only)
- Modify: `packages/web/src/App.tsx` (`initialForm` only)

**Interfaces:**
- Produces: `GrpcFormState` gains `secure: boolean` and `skipCertVerification: boolean`. `dsl.ts`'s gRPC `with` object gains matching `secure`/`skipCertVerification` fields. Consumed by `RequestBuilder`/`PasteGrpcurlPanel` (Task 5).

This task widens a type with only required fields, so every place that builds a `GrpcFormState` object literal must be updated in this same task or the workspace won't typecheck — exactly the same shape of change as the original gRPC Runner plan's Task 8.

- [ ] **Step 1: Widen `GrpcFormState` in `types.ts`**

In `packages/web/src/types.ts`, change:

```ts
export interface GrpcFormState {
  protoContent: string;
  protoFilename: string;
  serverAddress: string;
  service: string;
  method: string;
  requestMessage: string;
  metadata: KeyValueRow[];
}
```

to:

```ts
export interface GrpcFormState {
  protoContent: string;
  protoFilename: string;
  serverAddress: string;
  service: string;
  method: string;
  requestMessage: string;
  metadata: KeyValueRow[];
  secure: boolean;
  skipCertVerification: boolean;
}
```

- [ ] **Step 2: Write failing tests for the new fields flowing through `dsl.ts`**

In `packages/web/test/dsl.test.ts`, change the `emptyGrpc` helper:

```ts
function emptyGrpc(overrides: Partial<FormState['grpc']> = {}): FormState['grpc'] {
  return {
    protoContent: '',
    protoFilename: '',
    serverAddress: '',
    service: '',
    method: '',
    requestMessage: '',
    metadata: [],
    ...overrides,
  };
}
```

to:

```ts
function emptyGrpc(overrides: Partial<FormState['grpc']> = {}): FormState['grpc'] {
  return {
    protoContent: '',
    protoFilename: '',
    serverAddress: '',
    service: '',
    method: '',
    requestMessage: '',
    metadata: [],
    secure: true,
    skipCertVerification: false,
    ...overrides,
  };
}
```

Then, in the same file, change the `'builds a grpc interaction step from the grpc sub-object'` test's expected `with` object:

```ts
    expect(steps[0]).toEqual({
      type: 'interaction',
      runner: 'grpc',
      action: 'call',
      with: {
        proto: 'syntax = "proto3";',
        serverAddress: 'localhost:50051',
        service: 'PaymentService',
        method: 'CreatePayment',
        message: { amount: '100' },
        metadata: { 'x-request-id': 'abc' },
      },
    });
```

to:

```ts
    expect(steps[0]).toEqual({
      type: 'interaction',
      runner: 'grpc',
      action: 'call',
      with: {
        proto: 'syntax = "proto3";',
        serverAddress: 'localhost:50051',
        service: 'PaymentService',
        method: 'CreatePayment',
        message: { amount: '100' },
        metadata: { 'x-request-id': 'abc' },
        secure: true,
        skipCertVerification: false,
      },
    });
```

Then add this test right after the `'tags extract and question steps with the grpc runner too'` test, still inside the `describe('buildTaskSteps with protocol: grpc', ...)` block:

```ts

  it('carries secure and skipCertVerification through to the interaction step', () => {
    const steps = buildTestDefinition(
      emptyForm({
        protocol: 'grpc',
        grpc: emptyGrpc({ secure: false, skipCertVerification: true }),
      })
    ).tasks[0].steps;
    const interactionStep = steps[0] as unknown as { with: { secure: boolean; skipCertVerification: boolean } };
    expect(interactionStep.with.secure).toBe(false);
    expect(interactionStep.with.skipCertVerification).toBe(true);
  });
```

- [ ] **Step 3: Run the tests to verify the new ones fail (and every other `GrpcFormState`-literal test file fails to compile)**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `dsl.test.ts`'s updated/new assertions fail (the `with` object doesn't have `secure`/`skipCertVerification` yet); every other test file that builds a `GrpcFormState` literal fails to *compile* at this point too (missing `secure`/`skipCertVerification` fields) — expected, fixed in the next two steps.

- [ ] **Step 4: Wire the fields through in `dsl.ts`**

In `packages/web/src/dsl.ts`, change:

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
  return { type: 'interaction', runner: 'rest', action: 'request', with: buildRestRequestWith(form) };
}
```

to:

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
        secure: form.grpc.secure,
        skipCertVerification: form.grpc.skipCertVerification,
      },
    };
  }
  return { type: 'interaction', runner: 'rest', action: 'request', with: buildRestRequestWith(form) };
}
```

- [ ] **Step 5: Fix every other `GrpcFormState`-literal-building test helper and `App.tsx`**

In `packages/web/test/steps.test.ts`, change:

```ts
    grpc: {
      protoContent: '',
      protoFilename: '',
      serverAddress: '',
      service: '',
      method: '',
      requestMessage: '',
      metadata: [],
    },
```

to:

```ts
    grpc: {
      protoContent: '',
      protoFilename: '',
      serverAddress: '',
      service: '',
      method: '',
      requestMessage: '',
      metadata: [],
      secure: true,
      skipCertVerification: false,
    },
```

Apply the exact same change (the `grpc: { ... }` literal gains `secure: true,` and `skipCertVerification: false,` right after `metadata: [],`) in each of these files — each has one occurrence of the identical seven-field `grpc: { ... }` literal shown above:

- `packages/web/test/components/RunButton.test.tsx`
- `packages/web/test/components/FlowRunner.test.tsx`
- `packages/web/test/components/SaveStepButton.test.tsx`
- `packages/web/test/components/LoadStepSelect.test.tsx`
- `packages/web/src/App.tsx` (inside `initialForm()`)

In `packages/web/test/components/RequestBuilder.test.tsx`, change the `blankGrpc` helper:

```ts
function blankGrpc(): GrpcFormState {
  return {
    protoContent: '',
    protoFilename: '',
    serverAddress: '',
    service: '',
    method: '',
    requestMessage: '',
    metadata: [],
  };
}
```

to:

```ts
function blankGrpc(): GrpcFormState {
  return {
    protoContent: '',
    protoFilename: '',
    serverAddress: '',
    service: '',
    method: '',
    requestMessage: '',
    metadata: [],
    secure: true,
    skipCertVerification: false,
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including the new/updated `dsl.test.ts` assertions — every other file's tests pass unchanged now that their helpers compile again).

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/types.ts packages/web/src/dsl.ts packages/web/test/dsl.test.ts packages/web/test/steps.test.ts packages/web/test/components/RunButton.test.tsx packages/web/test/components/FlowRunner.test.tsx packages/web/test/components/SaveStepButton.test.tsx packages/web/test/components/LoadStepSelect.test.tsx packages/web/test/components/RequestBuilder.test.tsx packages/web/src/App.tsx
git commit -m "feat(web): widen GrpcFormState with secure/skipCertVerification fields"
```

---

### Task 4: `parseGrpcurl` `-plaintext`/`-insecure` mapping

**Files:**
- Modify: `packages/web/src/grpcurl.ts`
- Modify: `packages/web/test/grpcurl.test.ts`

**Interfaces:**
- Produces: `GrpcurlParseResult`'s `ok: true` variant gains `secure: boolean` and `skipCertVerification: boolean`. Consumed by `PasteGrpcurlPanel` (Task 5).

- [ ] **Step 1: Write failing tests for the four-way flag mapping**

In `packages/web/test/grpcurl.test.ts`, add this block at the end of the file, right before the final closing `});` of the `describe('parseGrpcurl', ...)` block:

```ts

  it('defaults to secure with verification when neither -plaintext nor -insecure is present', () => {
    const result = parseGrpcurl('grpcurl localhost:50051 payment.PaymentService/CreatePayment');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.secure).toBe(true);
    expect(result.skipCertVerification).toBe(false);
  });

  it('sets secure to false when -plaintext is present', () => {
    const result = parseGrpcurl('grpcurl -plaintext localhost:50051 payment.PaymentService/CreatePayment');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.secure).toBe(false);
    expect(result.skipCertVerification).toBe(false);
  });

  it('sets secure true and skipCertVerification true when -insecure is present', () => {
    const result = parseGrpcurl('grpcurl -insecure localhost:50051 payment.PaymentService/CreatePayment');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.secure).toBe(true);
    expect(result.skipCertVerification).toBe(true);
  });

  it('lets -plaintext win when both -plaintext and -insecure are present', () => {
    const result = parseGrpcurl(
      'grpcurl -plaintext -insecure localhost:50051 payment.PaymentService/CreatePayment'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.secure).toBe(false);
    expect(result.skipCertVerification).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `result.secure`/`result.skipCertVerification` are `undefined` (property doesn't exist yet on the parsed result).

- [ ] **Step 3: Implement the flag mapping in `grpcurl.ts`**

In `packages/web/src/grpcurl.ts`, change:

```ts
export type GrpcurlParseResult =
  | {
      ok: true;
      serverAddress: string;
      service: string;
      method: string;
      message: string;
      metadata: KeyValueRow[];
    }
  | { ok: false; error: string };
```

to:

```ts
export type GrpcurlParseResult =
  | {
      ok: true;
      serverAddress: string;
      service: string;
      method: string;
      message: string;
      metadata: KeyValueRow[];
      secure: boolean;
      skipCertVerification: boolean;
    }
  | { ok: false; error: string };
```

Then change:

```ts
  const tokens = tokenize(joinContinuations(trimmed)).slice(1);

  let message: string | null = null;
  const metadata: KeyValueRow[] = [];
  const positional: string[] = [];
```

to:

```ts
  const tokens = tokenize(joinContinuations(trimmed)).slice(1);

  let message: string | null = null;
  let plaintext = false;
  let insecure = false;
  const metadata: KeyValueRow[] = [];
  const positional: string[] = [];
```

Then change:

```ts
      case '-plaintext':
      case '--plaintext':
        break;
```

to:

```ts
      case '-plaintext':
      case '--plaintext':
        plaintext = true;
        break;
      case '-insecure':
      case '--insecure':
        insecure = true;
        break;
```

Finally, change:

```ts
  return { ok: true, serverAddress, service, method, message: message ?? '', metadata };
```

to:

```ts
  const secure = !plaintext;
  const skipCertVerification = secure && insecure;
  return { ok: true, serverAddress, service, method, message: message ?? '', metadata, secure, skipCertVerification };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including the 4 new ones — the 8 pre-existing `parseGrpcurl` tests don't assert on `secure`/`skipCertVerification` and remain unaffected).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/grpcurl.ts packages/web/test/grpcurl.test.ts
git commit -m "feat(web): map -plaintext/-insecure onto secure/skipCertVerification in parseGrpcurl"
```

---

### Task 5: `RequestBuilder` UI + `PasteGrpcurlPanel` threading

**Files:**
- Modify: `packages/web/src/components/PasteGrpcurlPanel.tsx`
- Modify: `packages/web/test/components/PasteGrpcurlPanel.test.tsx`
- Modify: `packages/web/src/components/RequestBuilder.tsx`
- Modify: `packages/web/test/components/RequestBuilder.test.tsx`

**Interfaces:**
- Consumes: `GrpcurlParseResult`'s new fields (Task 4), `GrpcFormState`'s new fields (Task 3).
- Produces: `PasteGrpcurlPanelResult` gains `secure: boolean` and `skipCertVerification: boolean`.

- [ ] **Step 1: Write a failing test for `PasteGrpcurlPanel` threading the new fields**

In `packages/web/test/components/PasteGrpcurlPanel.test.tsx`, change the `'calls onImport with the parsed result for a valid command'` test's expectation:

```ts
    expect(onImport).toHaveBeenCalledWith({
      serverAddress: 'localhost:50051',
      service: 'PaymentService',
      method: 'CreatePayment',
      message: '',
      metadata: [],
    });
```

to:

```ts
    expect(onImport).toHaveBeenCalledWith({
      serverAddress: 'localhost:50051',
      service: 'PaymentService',
      method: 'CreatePayment',
      message: '',
      metadata: [],
      secure: true,
      skipCertVerification: false,
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `PasteGrpcurlPanel`'s `onImport` call doesn't include `secure`/`skipCertVerification` yet.

- [ ] **Step 3: Thread the fields through `PasteGrpcurlPanel.tsx`**

In `packages/web/src/components/PasteGrpcurlPanel.tsx`, change:

```ts
export interface PasteGrpcurlPanelResult {
  serverAddress: string;
  service: string;
  method: string;
  message: string;
  metadata: KeyValueRow[];
}
```

to:

```ts
export interface PasteGrpcurlPanelResult {
  serverAddress: string;
  service: string;
  method: string;
  message: string;
  metadata: KeyValueRow[];
  secure: boolean;
  skipCertVerification: boolean;
}
```

Then change:

```ts
    if (result.ok) {
      onImport({
        serverAddress: result.serverAddress,
        service: result.service,
        method: result.method,
        message: result.message,
        metadata: result.metadata,
      });
      setFeedback({ type: 'success', text: 'Imported.' });
```

to:

```ts
    if (result.ok) {
      onImport({
        serverAddress: result.serverAddress,
        service: result.service,
        method: result.method,
        message: result.message,
        metadata: result.metadata,
        secure: result.secure,
        skipCertVerification: result.skipCertVerification,
      });
      setFeedback({ type: 'success', text: 'Imported.' });
```

- [ ] **Step 4: Run the tests to verify the `PasteGrpcurlPanel` test passes**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: `PasteGrpcurlPanel.test.tsx` PASSES. `RequestBuilder.test.tsx` still FAILS to compile at this point — `RequestBuilder.tsx`'s `PasteGrpcurlPanel` `onImport` handler doesn't yet forward the two new fields into `onGrpcChange`, and no checkboxes exist yet. Fixed in the next step.

- [ ] **Step 5: Write failing tests for the two checkboxes**

In `packages/web/test/components/RequestBuilder.test.tsx`, change the `'switches to the Paste grpcurl tab and applies a successful import'` test's expectation:

```ts
    expect(onGrpcChange).toHaveBeenCalledWith(
      expect.objectContaining({
        serverAddress: 'localhost:50051',
        service: 'PaymentService',
        method: 'CreatePayment',
      })
    );
```

to:

```ts
    expect(onGrpcChange).toHaveBeenCalledWith(
      expect.objectContaining({
        serverAddress: 'localhost:50051',
        service: 'PaymentService',
        method: 'CreatePayment',
        secure: true,
        skipCertVerification: false,
      })
    );
```

Then add this block at the end of the file, right before the final closing `});` of the `describe('RequestBuilder', ...)` block:

```ts

  it('renders the Secure and Skip certificate verification checkboxes with their current values', () => {
    render(
      <RequestBuilder
        {...baseProps({
          protocol: 'grpc',
          grpc: { ...blankGrpc(), secure: true, skipCertVerification: false },
        })}
      />
    );
    expect(screen.getByLabelText('Secure (TLS)')).toBeChecked();
    expect(screen.getByLabelText('Skip certificate verification')).not.toBeChecked();
    expect(screen.getByLabelText('Skip certificate verification')).toBeEnabled();
  });

  it('disables Skip certificate verification when Secure is off', () => {
    render(
      <RequestBuilder
        {...baseProps({ protocol: 'grpc', grpc: { ...blankGrpc(), secure: false } })}
      />
    );
    expect(screen.getByLabelText('Skip certificate verification')).toBeDisabled();
  });

  it('calls onGrpcChange when the Secure checkbox is toggled', async () => {
    const onGrpcChange = vi.fn();
    render(
      <RequestBuilder
        {...baseProps({
          protocol: 'grpc',
          onGrpcChange,
          grpc: { ...blankGrpc(), secure: true },
        })}
      />
    );
    await userEvent.click(screen.getByLabelText('Secure (TLS)'));
    expect(onGrpcChange).toHaveBeenCalledWith(expect.objectContaining({ secure: false }));
  });

  it('calls onGrpcChange when Skip certificate verification is toggled', async () => {
    const onGrpcChange = vi.fn();
    render(
      <RequestBuilder
        {...baseProps({
          protocol: 'grpc',
          onGrpcChange,
          grpc: { ...blankGrpc(), secure: true, skipCertVerification: false },
        })}
      />
    );
    await userEvent.click(screen.getByLabelText('Skip certificate verification'));
    expect(onGrpcChange).toHaveBeenCalledWith(expect.objectContaining({ skipCertVerification: true }));
  });
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `screen.getByLabelText('Secure (TLS)')` and `'Skip certificate verification'` don't exist yet, and the grpcurl-import test's `secure`/`skipCertVerification` expectations aren't met.

- [ ] **Step 7: Add the checkboxes and wire the import handler in `RequestBuilder.tsx`**

In `packages/web/src/components/RequestBuilder.tsx`, change:

```tsx
        ) : (
          <label className="label">
            Server Address
            <input
              className="text-input"
              value={grpc.serverAddress}
              onChange={(e) => onGrpcChange({ ...grpc, serverAddress: e.target.value })}
            />
          </label>
        )}
      </div>
```

to:

```tsx
        ) : (
          <>
            <label className="label">
              Server Address
              <input
                className="text-input"
                value={grpc.serverAddress}
                onChange={(e) => onGrpcChange({ ...grpc, serverAddress: e.target.value })}
              />
            </label>
            <label className="label">
              Secure (TLS)
              <input
                type="checkbox"
                checked={grpc.secure}
                onChange={(e) => onGrpcChange({ ...grpc, secure: e.target.checked })}
              />
            </label>
            <label className="label">
              Skip certificate verification
              <input
                type="checkbox"
                checked={grpc.skipCertVerification}
                disabled={!grpc.secure}
                onChange={(e) => onGrpcChange({ ...grpc, skipCertVerification: e.target.checked })}
              />
            </label>
          </>
        )}
      </div>
```

Then change:

```tsx
          {grpcTab === 'grpcurl' && (
            <PasteGrpcurlPanel
              onImport={(r) =>
                onGrpcChange({
                  ...grpc,
                  serverAddress: r.serverAddress,
                  service: r.service,
                  method: r.method,
                  requestMessage: r.message,
                  metadata: r.metadata,
                })
              }
            />
          )}
```

to:

```tsx
          {grpcTab === 'grpcurl' && (
            <PasteGrpcurlPanel
              onImport={(r) =>
                onGrpcChange({
                  ...grpc,
                  serverAddress: r.serverAddress,
                  service: r.service,
                  method: r.method,
                  requestMessage: r.message,
                  metadata: r.metadata,
                  secure: r.secure,
                  skipCertVerification: r.skipCertVerification,
                })
              }
            />
          )}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including the 4 new checkbox-related ones and the updated grpcurl-import assertion — every existing REST-mode test still passes unchanged).

- [ ] **Step 9: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/components/PasteGrpcurlPanel.tsx packages/web/test/components/PasteGrpcurlPanel.test.tsx packages/web/src/components/RequestBuilder.tsx packages/web/test/components/RequestBuilder.test.tsx
git commit -m "feat(web): add Secure/Skip-certificate-verification checkboxes to RequestBuilder"
```

---

### Task 6: Final verification

**Files:** none created or modified — this task only runs checks.

**Interfaces:** none.

- [ ] **Step 1: Run the full workspace test suite and typecheck**

Run: `pnpm test`
Expected: PASS across all 6 packages (`engine`, `runner-api`, `runner-grpc`, `runner-log`, `server`, `web`), no newly failing tests.

Run: `pnpm typecheck`
Expected: no errors in any package.

- [ ] **Step 2: Manual browser verification**

Start the backend (`pnpm --filter @ai-native-testing/server start`) and the GUI dev server (`pnpm --filter @ai-native-testing/web dev`). You'll need a real TLS gRPC server to test against — write a short standalone script using `startFakeSecurePaymentGrpcServer` from `@ai-native-testing/runner-grpc`, logging its address and proto content, then keeping the process alive (e.g. run it with `tsx`) so you can point the GUI at it.

In the GUI, with Protocol set to gRPC, confirm:

- The "Secure (TLS)" checkbox is checked by default on a fresh form.
- "Skip certificate verification" is disabled (greyed out) whenever "Secure (TLS)" is unchecked.
- Filling in Server Address (the fake secure server's address), Proto (upload), Service, Method, and a JSON Message, then clicking Run **with "Secure (TLS)" checked and "Skip certificate verification" unchecked**, produces a failed call (non-zero status) — the fake server's self-signed cert isn't trusted by the system's default certificate store, proving verification is genuinely happening, not silently skipped.
- Checking "Skip certificate verification" and clicking Run again against the same fake secure server now produces a real, successful response (`status: 0`, decoded `paymentId`/`status`) — proving `rejectUnauthorized: false` is correctly wired end to end.
- Unchecking "Secure (TLS)" and running against the *plaintext* fake server (`startFakePaymentGrpcServer`, if you also start one) still works exactly as before — proving the plaintext path is unaffected by this change.
- Pasting a `grpcurl` command containing `-insecure` (matching the fake secure server) correctly checks both "Secure (TLS)" and "Skip certificate verification" after import.

Take a screenshot as evidence, same as prior manual verifications in this project.

- [ ] **Step 3: Commit (if the manual check surfaced any fix)**

If Step 2 finds nothing to fix, there is nothing to commit for this task. If it does surface an issue, fix it, re-run Step 1, and commit:

```bash
git add -A
git commit -m "fix: correct issue found during manual gRPC TLS verification"
```
