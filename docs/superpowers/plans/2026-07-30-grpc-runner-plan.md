# gRPC Runner (Minimal Slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal, real, end-to-end gRPC calling capability: a Protocol toggle (REST | gRPC) in the Request Builder, a new `GrpcRunner`, proto-driven Service/Method suggestions, a "Paste grpcurl" import, and mixed REST+gRPC E2E Flows.

**Architecture:** A new `packages/runner-grpc` package (mirroring `runner-api`'s `Runner`-interface shape) invokes unary RPCs dynamically via `@grpc/grpc-js` + `@grpc/proto-loader`, no codegen. The engine's `Runner` interface is already protocol-agnostic, so no engine changes are needed. `FormState`/`dsl.ts` become protocol-aware (`buildTaskSteps` branches only on how the interaction step is built), so mixed-protocol E2E Flows fall out automatically once each saved step is tagged with its own protocol.

**Tech Stack:** TypeScript, Fastify, React + Vite, Vitest — plus `@grpc/grpc-js` and `@grpc/proto-loader`, the first new runtime dependencies since `ajv`.

Spec: [`docs/superpowers/specs/2026-07-30-grpc-runner-design.md`](../specs/2026-07-30-grpc-runner-design.md)

## Global Constraints

- Plaintext (insecure) gRPC connections only — no TLS in this slice.
- `status` extract/question actions on a gRPC step return the raw numeric gRPC status code (`0` = OK) — no name lookup table.
- Service/Method in the GUI are `<datalist>`-backed free-text inputs (same combobox pattern as Actor/Task), never strict `<select>`s — proto introspection only supplies *suggestions*.
- `-plaintext` and `-proto` in a pasted `grpcurl` command are recognized but ignored; any other unknown flag is silently ignored (never a parse failure) — matches `parseCurl`'s policy.
- The Extract/Questions source-kind dropdown stays labeled "header" for both protocols — no gRPC-specific relabeling to "metadata" in this slice.
- Streaming RPCs, a dynamic per-field message editor, "Import Swagger", and a status-code-to-name lookup are all out of scope — do not implement them.
- `SaveStepButton`/`LoadStepSelect`/`AddToFlowButton`/`FlowRunner` need no code changes — they already treat a saved step as an opaque whole `FormState`.
- `packages/web/vite.config.ts`'s dev proxy must include `/grpc` — remember this explicitly; a missed proxy entry was found and fixed during the previous (Save-as-Reusable-Step) increment's manual verification.

---

### Task 1: Extract shared utilities

**Files:**
- Create: `packages/engine/src/json-path.ts`
- Create: `packages/engine/test/json-path.test.ts`
- Delete: `packages/runner-api/src/json-path.ts`
- Delete: `packages/runner-api/test/json-path.test.ts`
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/runner-api/src/rest-runner.ts`
- Modify: `packages/runner-api/src/index.ts`
- Create: `packages/web/src/shellTokenize.ts`
- Create: `packages/web/test/shellTokenize.test.ts`
- Modify: `packages/web/src/curl.ts`

**Interfaces:**
- Produces: `extractJsonPath(value: unknown, path: string): unknown` now exported from `@ai-native-testing/engine` (previously only from `@ai-native-testing/runner-api`). `joinContinuations(input: string): string` and `tokenize(input: string): string[]` now exported from `packages/web/src/shellTokenize.ts`. Both consumed by `GrpcRunner` (Task 3) and `grpcurl.ts` (Task 6) respectively.

- [ ] **Step 1: Move `extractJsonPath` into `packages/engine`**

Create `packages/engine/src/json-path.ts` with the exact current contents of `packages/runner-api/src/json-path.ts`:

```ts
export function extractJsonPath(value: unknown, path: string): unknown {
  const segments = parsePath(path);
  let current: unknown = value;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      throw new Error(`JSONPath "${path}" could not be resolved: reached ${String(current)} at "${segment}"`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (current === undefined) {
    throw new Error(`JSONPath "${path}" did not resolve to a value`);
  }
  return current;
}

function parsePath(path: string): string[] {
  if (!path.startsWith('$')) {
    throw new Error(`JSONPath "${path}" must start with "$"`);
  }
  const rest = path.slice(1);
  const segments: string[] = [];
  const regex = /\.([^.[\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  while ((match = regex.exec(rest)) !== null) {
    if (match.index !== lastIndex) {
      throw new Error(`JSONPath "${path}" is malformed near "${rest.slice(lastIndex)}"`);
    }
    segments.push((match[1] ?? match[2]) as string);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex !== rest.length) {
    throw new Error(`JSONPath "${path}" is malformed near "${rest.slice(lastIndex)}"`);
  }
  return segments;
}
```

Create `packages/engine/test/json-path.test.ts` with the exact current contents of `packages/runner-api/test/json-path.test.ts`, only changing the import path:

```ts
import { describe, it, expect } from 'vitest';
import { extractJsonPath } from '../src/json-path.js';

describe('extractJsonPath', () => {
  it('extracts a nested string field', () => {
    const body = { data: { paymentId: 'pay_123' } };
    expect(extractJsonPath(body, '$.data.paymentId')).toBe('pay_123');
  });

  it('extracts a value from an array index', () => {
    const body = { data: { items: [{ id: 'a' }, { id: 'b' }] } };
    expect(extractJsonPath(body, '$.data.items[1].id')).toBe('b');
  });

  it('throws when the path does not start with $', () => {
    expect(() => extractJsonPath({}, 'data.id')).toThrow('must start with "$"');
  });

  it('throws when an intermediate segment is missing', () => {
    const body = { data: {} };
    expect(() => extractJsonPath(body, '$.data.missing.deeper')).toThrow(/could not be resolved/);
  });

  it('throws when the final value is undefined', () => {
    const body = { data: {} };
    expect(() => extractJsonPath(body, '$.data.missing')).toThrow(/did not resolve to a value/);
  });
});
```

Delete the two old files:

```bash
rm packages/runner-api/src/json-path.ts packages/runner-api/test/json-path.test.ts
```

In `packages/engine/src/index.ts`, change:

```ts
export { RunContext } from './context.js';
export { RunnerRegistry, type Runner } from './runner.js';
```

to:

```ts
export { RunContext } from './context.js';
export { RunnerRegistry, type Runner } from './runner.js';
export { extractJsonPath } from './json-path.js';
```

In `packages/runner-api/src/rest-runner.ts`, change:

```ts
import type { Runner, RunContext } from '@ai-native-testing/engine';
import { buildAuthHeaders, type AuthConfig } from './auth.js';
import { extractJsonPath } from './json-path.js';
```

to:

```ts
import type { Runner, RunContext } from '@ai-native-testing/engine';
import { extractJsonPath } from '@ai-native-testing/engine';
import { buildAuthHeaders, type AuthConfig } from './auth.js';
```

In `packages/runner-api/src/index.ts`, change:

```ts
export { RestRunner, type RestRunnerOptions } from './rest-runner.js';
export { buildAuthHeaders, type AuthConfig } from './auth.js';
export { extractJsonPath } from './json-path.js';
```

to:

```ts
export { RestRunner, type RestRunnerOptions } from './rest-runner.js';
export { buildAuthHeaders, type AuthConfig } from './auth.js';
export { extractJsonPath } from '@ai-native-testing/engine';
```

- [ ] **Step 2: Run the engine and runner-api tests to verify they still pass**

Run: `pnpm --filter @ai-native-testing/engine test`
Expected: PASS, including the 5 relocated `json-path.test.ts` tests.

Run: `pnpm --filter @ai-native-testing/runner-api test`
Expected: PASS (all existing tests unaffected — `extractJsonPath` is still available, just re-exported).

- [ ] **Step 3: Extract `shellTokenize.ts` from `curl.ts`**

Create `packages/web/src/shellTokenize.ts` with the exact current bodies of `curl.ts`'s private `joinContinuations`/`tokenize` functions, now exported:

```ts
export function joinContinuations(input: string): string {
  return input.replace(/\\[ \t]*\r?\n[ \t]*/g, ' ');
}

export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let hasToken = false;
  let inSingle = false;
  let inDouble = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (inSingle) {
      if (ch === '\\' && input[i + 1] === "'") {
        current += "'";
        i += 2;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (inDouble) {
      if (ch === '\\' && (input[i + 1] === '"' || input[i + 1] === '\\')) {
        current += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      hasToken = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      hasToken = true;
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      i += 1;
      continue;
    }

    current += ch;
    hasToken = true;
    i += 1;
  }

  if (hasToken) {
    tokens.push(current);
  }
  return tokens;
}
```

Create `packages/web/test/shellTokenize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { joinContinuations, tokenize } from '../src/shellTokenize';

describe('joinContinuations', () => {
  it('joins a backslash-newline continuation into a single space', () => {
    expect(joinContinuations('foo \\\nbar')).toBe('foo bar');
  });

  it('leaves a string with no continuations unchanged', () => {
    expect(joinContinuations('foo bar')).toBe('foo bar');
  });
});

describe('tokenize', () => {
  it('splits on whitespace', () => {
    expect(tokenize('foo bar baz')).toEqual(['foo', 'bar', 'baz']);
  });

  it('keeps single-quoted content literal, including spaces', () => {
    expect(tokenize(`foo 'bar baz'`)).toEqual(['foo', 'bar baz']);
  });

  it('keeps double-quoted content literal, including spaces', () => {
    expect(tokenize(`foo "bar baz"`)).toEqual(['foo', 'bar baz']);
  });

  it('unescapes an escaped single quote inside a single-quoted token', () => {
    expect(tokenize(`'it\\'s here'`)).toEqual(["it's here"]);
  });

  it('unescapes an escaped double quote inside a double-quoted token', () => {
    expect(tokenize(`"say \\"hi\\""`)).toEqual(['say "hi"']);
  });
});
```

In `packages/web/src/curl.ts`, change:

```ts
import type { KeyValueRow } from './types';

export type CurlParseResult =
  | { ok: true; method: string; url: string; headers: KeyValueRow[]; body: string }
  | { ok: false; error: string };

const SUPPORTED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const IGNORED_VALUE_FLAGS = new Set(['-F', '--form', '-A', '--user-agent']);

function joinContinuations(input: string): string {
  return input.replace(/\\[ \t]*\r?\n[ \t]*/g, ' ');
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let hasToken = false;
  let inSingle = false;
  let inDouble = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (inSingle) {
      if (ch === '\\' && input[i + 1] === "'") {
        current += "'";
        i += 2;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (inDouble) {
      if (ch === '\\' && (input[i + 1] === '"' || input[i + 1] === '\\')) {
        current += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      hasToken = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      hasToken = true;
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      i += 1;
      continue;
    }

    current += ch;
    hasToken = true;
    i += 1;
  }

  if (hasToken) {
    tokens.push(current);
  }
  return tokens;
}
```

to:

```ts
import type { KeyValueRow } from './types';
import { joinContinuations, tokenize } from './shellTokenize.js';

export type CurlParseResult =
  | { ok: true; method: string; url: string; headers: KeyValueRow[]; body: string }
  | { ok: false; error: string };

const SUPPORTED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const IGNORED_VALUE_FLAGS = new Set(['-F', '--form', '-A', '--user-agent']);
```

(everything below this point in `curl.ts` — `parseCurl` and its body — stays exactly as it is; only the tokenizer functions move out and the import is added).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS — all existing `curl.test.ts` tests still pass unchanged (they test `parseCurl`'s behavior, not the tokenizer directly), plus the 7 new `shellTokenize.test.ts` tests.

- [ ] **Step 5: Typecheck the whole workspace and commit**

Run: `pnpm typecheck`
Expected: no errors in any package.

```bash
git add packages/engine/src/json-path.ts packages/engine/test/json-path.test.ts packages/engine/src/index.ts packages/runner-api/src/json-path.ts packages/runner-api/test/json-path.test.ts packages/runner-api/src/rest-runner.ts packages/runner-api/src/index.ts packages/web/src/shellTokenize.ts packages/web/test/shellTokenize.test.ts packages/web/src/curl.ts
git commit -m "refactor: extract extractJsonPath into engine and shellTokenize into a shared module"
```

---

### Task 2: `packages/runner-grpc` scaffolding + `proto.ts`

**Files:**
- Create: `packages/runner-grpc/package.json`
- Create: `packages/runner-grpc/tsconfig.json`
- Create: `packages/runner-grpc/src/proto.ts`
- Create: `packages/runner-grpc/test/proto.test.ts`

**Interfaces:**
- Produces: `ServiceDefinition` (`{ service: string; methods: string[] }`), `loadPackageDefinition(protoContent: string): grpc.GrpcObject`, `listServices(protoContent: string): ServiceDefinition[]`, `findService(protoContent: string, serviceName: string): grpc.ServiceClientConstructor`. Consumed by `GrpcRunner` (Task 3) and the `/grpc/introspect` route (Task 4).

- [ ] **Step 1: Scaffold the package**

Create `packages/runner-grpc/package.json`:

```json
{
  "name": "@ai-native-testing/runner-grpc",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ai-native-testing/engine": "workspace:*",
    "@grpc/grpc-js": "^1.14.4",
    "@grpc/proto-loader": "^0.8.1"
  },
  "devDependencies": {
    "@types/node": "^26.1.1",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

Create `packages/runner-grpc/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

Run: `pnpm install`
Expected: installs `@grpc/grpc-js` and `@grpc/proto-loader` into the new package.

- [ ] **Step 2: Write failing tests for `proto.ts`**

Create `packages/runner-grpc/test/proto.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { listServices, findService } from '../src/proto.js';

const SAMPLE_PROTO = `
syntax = "proto3";
package payment;

message CreatePaymentRequest {
  string amount = 1;
}

message CreatePaymentResponse {
  string paymentId = 1;
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

describe('listServices', () => {
  it('enumerates the service and its methods from the proto content', () => {
    const services = listServices(SAMPLE_PROTO);
    expect(services).toEqual([{ service: 'PaymentService', methods: ['CreatePayment', 'GetPayment'] }]);
  });

  it('throws a clear error for malformed proto content', () => {
    expect(() => listServices('not a valid proto file')).toThrow();
  });
});

describe('findService', () => {
  it('locates a service by its bare name even though the proto declares a package', () => {
    const ServiceCtor = findService(SAMPLE_PROTO, 'PaymentService');
    expect(typeof ServiceCtor).toBe('function');
  });

  it('throws when no service matches the given name', () => {
    expect(() => findService(SAMPLE_PROTO, 'Missing')).toThrow('Service "Missing" not found in proto');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/runner-grpc test`
Expected: FAIL — `../src/proto.js` does not exist.

- [ ] **Step 4: Implement `proto.ts`**

Create `packages/runner-grpc/src/proto.ts`:

```ts
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ServiceDefinition {
  service: string;
  methods: string[];
}

interface ServiceLikeConstructor {
  service?: Record<string, unknown>;
}

export function loadPackageDefinition(protoContent: string): grpc.GrpcObject {
  const dir = mkdtempSync(join(tmpdir(), 'grpc-proto-'));
  const filePath = join(dir, 'service.proto');
  writeFileSync(filePath, protoContent);
  try {
    const packageDefinition = protoLoader.loadSync(filePath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    return grpc.loadPackageDefinition(packageDefinition);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function walk(
  node: grpc.GrpcObject,
  visit: (key: string, ctor: ServiceLikeConstructor) => boolean
): boolean {
  for (const [key, value] of Object.entries(node)) {
    const ctor = value as unknown as ServiceLikeConstructor;
    if (typeof value === 'function' && ctor.service) {
      if (visit(key, ctor)) {
        return true;
      }
      continue;
    }
    if (typeof value === 'object' && value !== null) {
      if (walk(value as grpc.GrpcObject, visit)) {
        return true;
      }
    }
  }
  return false;
}

export function listServices(protoContent: string): ServiceDefinition[] {
  const packageObject = loadPackageDefinition(protoContent);
  const results: ServiceDefinition[] = [];
  walk(packageObject, (key, ctor) => {
    results.push({ service: key, methods: Object.keys(ctor.service ?? {}) });
    return false;
  });
  return results;
}

export function findService(protoContent: string, serviceName: string): grpc.ServiceClientConstructor {
  const packageObject = loadPackageDefinition(protoContent);
  let found: grpc.ServiceClientConstructor | undefined;
  walk(packageObject, (key, ctor) => {
    if (key === serviceName) {
      found = ctor as unknown as grpc.ServiceClientConstructor;
      return true;
    }
    return false;
  });
  if (!found) {
    throw new Error(`Service "${serviceName}" not found in proto`);
  }
  return found;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/runner-grpc test`
Expected: PASS (all 4 tests).

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/runner-grpc typecheck`
Expected: no errors.

```bash
git add packages/runner-grpc/package.json packages/runner-grpc/tsconfig.json packages/runner-grpc/src/proto.ts packages/runner-grpc/test/proto.test.ts pnpm-lock.yaml
git commit -m "feat(runner-grpc): scaffold package and add proto introspection"
```

---

### Task 3: `GrpcRunner` + fake gRPC test server helper

**Files:**
- Create: `packages/runner-grpc/src/grpc-runner.ts`
- Create: `packages/runner-grpc/src/testing.ts`
- Create: `packages/runner-grpc/test/grpc-runner.test.ts`
- Modify: `packages/runner-grpc/src/index.ts` (create if it doesn't exist yet)

**Interfaces:**
- Consumes: `findService` (Task 2).
- Produces: `GrpcRunner` class (implements engine's `Runner`), `startFakePaymentGrpcServer(): Promise<FakeGrpcServer>` (`FakeGrpcServer = { address: string; proto: string; close: () => Promise<void> }`). Both consumed by `packages/server` (Task 4, Task 11).

- [ ] **Step 1: Write the fake gRPC test server helper**

Create `packages/runner-grpc/src/testing.ts`:

```ts
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

export interface FakeGrpcServer {
  address: string;
  proto: string;
  close: () => Promise<void>;
}

export async function startFakePaymentGrpcServer(): Promise<FakeGrpcServer> {
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
  const paymentServiceDefinition = packageObject.test.PaymentService.service;

  const server = new grpc.Server();
  server.addService(paymentServiceDefinition, {
    CreatePayment: (
      call: grpc.ServerUnaryCall<{ amount: string; customerId: string }, unknown>,
      callback: grpc.sendUnaryData<{ paymentId: string; status: string }>
    ) => {
      callback(null, { paymentId: 'pay-123', status: 'CREATED' });
    },
    GetPayment: (
      call: grpc.ServerUnaryCall<{ paymentId: string }, unknown>,
      callback: grpc.sendUnaryData<{ status: string }>
    ) => {
      callback(null, { status: 'SUCCESS' });
    },
  });

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
```

- [ ] **Step 2: Write failing tests for `GrpcRunner`**

Create `packages/runner-grpc/test/grpc-runner.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { RunContext } from '@ai-native-testing/engine';
import { GrpcRunner } from '../src/grpc-runner.js';
import { startFakePaymentGrpcServer, type FakeGrpcServer } from '../src/testing.js';

describe('GrpcRunner', () => {
  let server: FakeGrpcServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('invokes a unary call and remembers the decoded response', async () => {
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
    expect(await runner.ask('raw', {}, ctx)).toMatchObject({
      status: 0,
      body: { paymentId: 'pay-123', status: 'CREATED' },
    });
    expect(await runner.ask('jsonPath', { path: '$.paymentId' }, ctx)).toBe('pay-123');
  });

  it('throws a clear error when the service is unknown', async () => {
    server = await startFakePaymentGrpcServer();
    const runner = new GrpcRunner();
    const ctx = new RunContext();

    await expect(
      runner.interact(
        'call',
        {
          proto: server.proto,
          serverAddress: server.address,
          service: 'MissingService',
          method: 'CreatePayment',
          message: {},
        },
        ctx
      )
    ).rejects.toThrow('Service "MissingService" not found in proto');
  });

  it('throws when ask is called before any call interaction', async () => {
    const runner = new GrpcRunner();
    const ctx = new RunContext();
    await expect(runner.ask('status', {}, ctx)).rejects.toThrow(
      'GrpcRunner "status" called before any "call" interaction'
    );
  });

  it('rejects an unsupported interaction action', async () => {
    const runner = new GrpcRunner();
    const ctx = new RunContext();
    await expect(runner.interact('unknown', {}, ctx)).rejects.toThrow(
      'GrpcRunner does not support interaction "unknown"'
    );
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/runner-grpc test`
Expected: FAIL — `../src/grpc-runner.js` does not exist.

- [ ] **Step 4: Implement `GrpcRunner`**

Create `packages/runner-grpc/src/grpc-runner.ts`:

```ts
import * as grpc from '@grpc/grpc-js';
import { extractJsonPath, type Runner, type RunContext } from '@ai-native-testing/engine';
import { findService } from './proto.js';

interface GrpcCallArgs {
  proto: string;
  serverAddress: string;
  service: string;
  method: string;
  message: unknown;
  metadata?: Record<string, string>;
}

interface GrpcResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

const LAST_RESPONSE_KEY = '__grpc.lastResponse';

export class GrpcRunner implements Runner {
  name = 'grpc';

  async interact(action: string, args: Record<string, unknown>, ctx: RunContext): Promise<void> {
    if (action !== 'call') {
      throw new Error(`GrpcRunner does not support interaction "${action}"`);
    }
    const response = await this.callUnary(args as unknown as GrpcCallArgs);
    ctx.remember(LAST_RESPONSE_KEY, response);
  }

  async ask(action: string, args: Record<string, unknown>, ctx: RunContext): Promise<unknown> {
    const response = ctx.get(LAST_RESPONSE_KEY) as GrpcResponse | undefined;
    if (!response) {
      throw new Error(`GrpcRunner "${action}" called before any "call" interaction`);
    }
    switch (action) {
      case 'status':
        return response.status;
      case 'header':
        return response.headers[String(args.name).toLowerCase()];
      case 'jsonPath':
        return extractJsonPath(response.body, String(args.path));
      case 'raw':
        return response;
      default:
        throw new Error(`GrpcRunner does not support question "${action}"`);
    }
  }

  private async callUnary(args: GrpcCallArgs): Promise<GrpcResponse> {
    const ServiceCtor = findService(args.proto, args.service);
    const client = new ServiceCtor(args.serverAddress, grpc.credentials.createInsecure());

    const grpcMetadata = new grpc.Metadata();
    for (const [key, value] of Object.entries(args.metadata ?? {})) {
      grpcMetadata.set(key, value);
    }

    const method = (client as unknown as Record<string, unknown>)[args.method];
    if (typeof method !== 'function') {
      throw new Error(`Method "${args.method}" not found on service "${args.service}"`);
    }

    return new Promise((resolve) => {
      let status = grpc.status.OK;
      let body: unknown = null;

      const call = (method as (...callArgs: unknown[]) => grpc.ClientUnaryCall).call(
        client,
        args.message,
        grpcMetadata,
        (err: grpc.ServiceError | null, response: unknown) => {
          if (err) {
            status = err.code ?? grpc.status.UNKNOWN;
            body = err.details ?? null;
          } else {
            body = response;
          }
        }
      );

      call.on('status', (callStatus: grpc.StatusObject) => {
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(callStatus.metadata.getMap())) {
          headers[key.toLowerCase()] = String(value);
        }
        resolve({ status, headers, body });
      });
    });
  }
}
```

- [ ] **Step 5: Wire up `index.ts`**

Create `packages/runner-grpc/src/index.ts`:

```ts
export { GrpcRunner } from './grpc-runner.js';
export { listServices, findService, type ServiceDefinition } from './proto.js';
export { startFakePaymentGrpcServer, FAKE_PAYMENT_PROTO, type FakeGrpcServer } from './testing.js';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/runner-grpc test`
Expected: PASS (all 4 `GrpcRunner` tests, plus the existing 4 `proto.test.ts` tests).

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/runner-grpc typecheck`
Expected: no errors.

```bash
git add packages/runner-grpc/src/grpc-runner.ts packages/runner-grpc/src/testing.ts packages/runner-grpc/src/index.ts packages/runner-grpc/test/grpc-runner.test.ts
git commit -m "feat(runner-grpc): add GrpcRunner and a fake gRPC test server helper"
```

---

### Task 4: `/grpc/introspect` route + server wiring

**Files:**
- Create: `packages/server/src/routes/grpc.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/package.json`
- Create: `packages/server/test/grpc-routes.test.ts`

**Interfaces:**
- Consumes: `listServices`, `GrpcRunner` (Task 2, Task 3).
- Produces: `registerGrpcRoutes(app): void`. `POST /grpc/introspect` consumed by the frontend (Task 5, indirectly, via HTTP).

- [ ] **Step 1: Add the `runner-grpc` dependency**

In `packages/server/package.json`, change:

```json
  "dependencies": {
    "@ai-native-testing/engine": "workspace:*",
    "@ai-native-testing/runner-log": "workspace:*",
    "@ai-native-testing/runner-api": "workspace:*",
    "fastify": "^5.1.0"
  },
```

to:

```json
  "dependencies": {
    "@ai-native-testing/engine": "workspace:*",
    "@ai-native-testing/runner-log": "workspace:*",
    "@ai-native-testing/runner-api": "workspace:*",
    "@ai-native-testing/runner-grpc": "workspace:*",
    "fastify": "^5.1.0"
  },
```

Run: `pnpm install`

- [ ] **Step 2: Write failing route tests**

Create `packages/server/test/grpc-routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';

const SAMPLE_PROTO = `
syntax = "proto3";
package test;

message PingRequest {
  string message = 1;
}

message PingResponse {
  string reply = 1;
}

service PingService {
  rpc Ping (PingRequest) returns (PingResponse);
}
`;

describe('POST /grpc/introspect', () => {
  it('returns the services and methods discovered in a valid proto', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: '/grpc/introspect', payload: { proto: SAMPLE_PROTO } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ services: [{ service: 'PingService', methods: ['Ping'] }] });
  });

  it('returns 400 for invalid proto content', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/grpc/introspect',
      payload: { proto: 'not a valid proto file' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for missing proto content', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: '/grpc/introspect', payload: {} });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test`
Expected: FAIL — `POST /grpc/introspect` doesn't exist yet (404).

- [ ] **Step 4: Implement the route**

Create `packages/server/src/routes/grpc.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { listServices } from '@ai-native-testing/runner-grpc';

export function registerGrpcRoutes(app: FastifyInstance): void {
  app.post('/grpc/introspect', async (request, reply) => {
    const { proto } = (request.body ?? {}) as { proto?: string };
    if (!proto || proto.trim() === '') {
      return reply.code(400).send({ error: 'proto is required' });
    }
    try {
      const services = listServices(proto);
      return { services };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
```

- [ ] **Step 5: Wire `GrpcRunner` and the new route into `buildApp`**

In `packages/server/src/app.ts`, change:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RunnerRegistry } from '@ai-native-testing/engine';
import { LogRunner } from '@ai-native-testing/runner-log';
import { RestRunner } from '@ai-native-testing/runner-api';
import { JobStore } from './job-store.js';
import { registerRunRoutes } from './routes/runs.js';
import { NameListStore } from './name-list-store.js';
import { registerNameListRoutes } from './routes/name-lists.js';
import { StepStore } from './step-store.js';
import { registerStepRoutes } from './routes/steps.js';
import { FlowStore } from './flow-store.js';
import { registerFlowRoutes } from './routes/flows.js';
```

to:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RunnerRegistry } from '@ai-native-testing/engine';
import { LogRunner } from '@ai-native-testing/runner-log';
import { RestRunner } from '@ai-native-testing/runner-api';
import { GrpcRunner } from '@ai-native-testing/runner-grpc';
import { JobStore } from './job-store.js';
import { registerRunRoutes } from './routes/runs.js';
import { NameListStore } from './name-list-store.js';
import { registerNameListRoutes } from './routes/name-lists.js';
import { StepStore } from './step-store.js';
import { registerStepRoutes } from './routes/steps.js';
import { FlowStore } from './flow-store.js';
import { registerFlowRoutes } from './routes/flows.js';
import { registerGrpcRoutes } from './routes/grpc.js';
```

and change:

```ts
  const registry = new RunnerRegistry();
  registry.register(new LogRunner());
  registry.register(new RestRunner());
  const jobStore = new JobStore();

  registerRunRoutes(app, jobStore, registry);
```

to:

```ts
  const registry = new RunnerRegistry();
  registry.register(new LogRunner());
  registry.register(new RestRunner());
  registry.register(new GrpcRunner());
  const jobStore = new JobStore();

  registerRunRoutes(app, jobStore, registry);
  registerGrpcRoutes(app);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test`
Expected: PASS (all tests, including the 3 new ones).

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/server typecheck`
Expected: no errors.

```bash
git add packages/server/package.json packages/server/src/routes/grpc.ts packages/server/src/app.ts packages/server/test/grpc-routes.test.ts pnpm-lock.yaml
git commit -m "feat(server): register GrpcRunner and add /grpc/introspect"
```

---

### Task 5: `grpcIntrospect.ts` (frontend fetch wrapper)

**Files:**
- Create: `packages/web/src/grpcIntrospect.ts`
- Create: `packages/web/test/grpcIntrospect.test.ts`

**Interfaces:**
- Produces: `ServiceDefinition` (`{ service: string; methods: string[] }`), `introspectProto(protoContent: string): Promise<ServiceDefinition[] | undefined>`. Consumed by `RequestBuilder` (Task 9).

- [ ] **Step 1: Write failing tests**

Create `packages/web/test/grpcIntrospect.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { introspectProto } from '../src/grpcIntrospect';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('introspectProto', () => {
  it('returns the parsed services on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ services: [{ service: 'PaymentService', methods: ['CreatePayment'] }] }),
      })
    );
    expect(await introspectProto('syntax = "proto3";')).toEqual([
      { service: 'PaymentService', methods: ['CreatePayment'] },
    ]);
  });

  it('returns undefined when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await introspectProto('not valid')).toBeUndefined();
  });

  it('returns undefined when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await introspectProto('syntax = "proto3";')).toBeUndefined();
  });

  it('POSTs the proto content as JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ services: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await introspectProto('syntax = "proto3";');
    expect(fetchMock).toHaveBeenCalledWith('/grpc/introspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proto: 'syntax = "proto3";' }),
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `../src/grpcIntrospect` does not exist.

- [ ] **Step 3: Implement `grpcIntrospect.ts`**

Create `packages/web/src/grpcIntrospect.ts`:

```ts
export interface ServiceDefinition {
  service: string;
  methods: string[];
}

export async function introspectProto(protoContent: string): Promise<ServiceDefinition[] | undefined> {
  try {
    const response = await fetch('/grpc/introspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proto: protoContent }),
    });
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as { services: ServiceDefinition[] };
    return body.services;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including the 4 new ones).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/grpcIntrospect.ts packages/web/test/grpcIntrospect.test.ts
git commit -m "feat(web): add introspectProto for gRPC service/method discovery"
```

---

### Task 6: `grpcurl.ts` (parseGrpcurl)

**Files:**
- Create: `packages/web/src/grpcurl.ts`
- Create: `packages/web/test/grpcurl.test.ts`

**Interfaces:**
- Consumes: `joinContinuations`, `tokenize` (Task 1).
- Produces: `GrpcurlParseResult` (`{ ok: true; serverAddress: string; service: string; method: string; message: string; metadata: KeyValueRow[] } | { ok: false; error: string }`), `parseGrpcurl(input: string): GrpcurlParseResult`. Consumed by `PasteGrpcurlPanel` (Task 7).

- [ ] **Step 1: Write failing tests**

Create `packages/web/test/grpcurl.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseGrpcurl } from '../src/grpcurl';

describe('parseGrpcurl', () => {
  it('parses address, service, method, message, and metadata', () => {
    const result = parseGrpcurl(
      `grpcurl -plaintext -d '{"amount":"100"}' -H 'x-request-id: abc' localhost:50051 payment.PaymentService/CreatePayment`
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.serverAddress).toBe('localhost:50051');
    expect(result.service).toBe('PaymentService');
    expect(result.method).toBe('CreatePayment');
    expect(result.message).toBe('{"amount":"100"}');
    expect(result.metadata.map((m) => ({ key: m.key, value: m.value }))).toEqual([
      { key: 'x-request-id', value: 'abc' },
    ]);
  });

  it('strips the package prefix from the service, keeping the bare name', () => {
    const result = parseGrpcurl('grpcurl localhost:50051 payment.v1.PaymentService/CreatePayment');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.service).toBe('PaymentService');
  });

  it('handles a service with no package prefix', () => {
    const result = parseGrpcurl('grpcurl localhost:50051 PaymentService/CreatePayment');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.service).toBe('PaymentService');
  });

  it('ignores -proto and its value without treating the path as positional', () => {
    const result = parseGrpcurl(
      'grpcurl -proto payment.proto -plaintext localhost:50051 payment.PaymentService/CreatePayment'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.serverAddress).toBe('localhost:50051');
  });

  it('supports multi-line continuations', () => {
    const result = parseGrpcurl(
      `grpcurl -plaintext \\\n  -d '{"amount":"100"}' \\\n  localhost:50051 payment.PaymentService/CreatePayment`
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toBe('{"amount":"100"}');
  });

  it('errors when the input does not start with grpcurl', () => {
    const result = parseGrpcurl('curl localhost:50051');
    expect(result).toEqual({ ok: false, error: 'Command must start with "grpcurl"' });
  });

  it('errors when there are fewer than two positional arguments', () => {
    const result = parseGrpcurl('grpcurl -plaintext localhost:50051');
    expect(result).toEqual({
      ok: false,
      error: 'Command must include an address and a package.Service/Method',
    });
  });

  it('errors when the symbol has no slash', () => {
    const result = parseGrpcurl('grpcurl localhost:50051 PaymentService.CreatePayment');
    expect(result).toEqual({
      ok: false,
      error: 'Could not parse service/method from "PaymentService.CreatePayment"',
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `../src/grpcurl` does not exist.

- [ ] **Step 3: Implement `grpcurl.ts`**

Create `packages/web/src/grpcurl.ts`:

```ts
import type { KeyValueRow } from './types';
import { joinContinuations, tokenize } from './shellTokenize.js';

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

export function parseGrpcurl(input: string): GrpcurlParseResult {
  const trimmed = input.trim();
  if (!trimmed.startsWith('grpcurl')) {
    return { ok: false, error: 'Command must start with "grpcurl"' };
  }

  const tokens = tokenize(joinContinuations(trimmed)).slice(1);

  let message: string | null = null;
  const metadata: KeyValueRow[] = [];
  const positional: string[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    let token = tokens[i];
    let inlineValue: string | null = null;

    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        inlineValue = token.slice(eq + 1);
        token = token.slice(0, eq);
      }
    }

    const takeValue = (): string => {
      if (inlineValue !== null) {
        return inlineValue;
      }
      i += 1;
      return tokens[i] ?? '';
    };

    switch (token) {
      case '-d':
      case '--data':
        message = takeValue();
        break;
      case '-H':
      case '--header':
      case '--rpc-header': {
        const headerValue = takeValue();
        const colon = headerValue.indexOf(':');
        if (colon !== -1) {
          metadata.push({
            id: crypto.randomUUID(),
            key: headerValue.slice(0, colon).trim(),
            value: headerValue.slice(colon + 1).trim(),
          });
        }
        break;
      }
      case '-proto':
      case '--proto':
        takeValue();
        break;
      case '-plaintext':
      case '--plaintext':
        break;
      default:
        if (!token.startsWith('-')) {
          positional.push(inlineValue ?? token);
        }
        break;
    }
  }

  if (positional.length < 2) {
    return { ok: false, error: 'Command must include an address and a package.Service/Method' };
  }

  const serverAddress = positional[positional.length - 2];
  const symbol = positional[positional.length - 1];
  const slash = symbol.indexOf('/');
  if (slash === -1) {
    return { ok: false, error: `Could not parse service/method from "${symbol}"` };
  }
  const servicePath = symbol.slice(0, slash);
  const method = symbol.slice(slash + 1);
  const lastDot = servicePath.lastIndexOf('.');
  const service = lastDot === -1 ? servicePath : servicePath.slice(lastDot + 1);

  return { ok: true, serverAddress, service, method, message: message ?? '', metadata };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including the 8 new ones).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/grpcurl.ts packages/web/test/grpcurl.test.ts
git commit -m "feat(web): add parseGrpcurl for importing grpcurl commands"
```

---

### Task 7: `PasteGrpcurlPanel` component

**Files:**
- Create: `packages/web/src/components/PasteGrpcurlPanel.tsx`
- Create: `packages/web/test/components/PasteGrpcurlPanel.test.tsx`

**Interfaces:**
- Consumes: `parseGrpcurl` (Task 6).
- Produces: `PasteGrpcurlPanelResult` (`{ serverAddress: string; service: string; method: string; message: string; metadata: KeyValueRow[] }`), `PasteGrpcurlPanelProps` (`{ onImport: (result: PasteGrpcurlPanelResult) => void }`). Consumed by `RequestBuilder` (Task 9).

- [ ] **Step 1: Write failing tests**

Create `packages/web/test/components/PasteGrpcurlPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PasteGrpcurlPanel } from '../../src/components/PasteGrpcurlPanel';

describe('PasteGrpcurlPanel', () => {
  it('disables Import when the textarea is empty', () => {
    render(<PasteGrpcurlPanel onImport={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('calls onImport with the parsed result for a valid command', async () => {
    const onImport = vi.fn();
    render(<PasteGrpcurlPanel onImport={onImport} />);
    await userEvent.type(
      screen.getByLabelText('grpcurl command'),
      'grpcurl localhost:50051 payment.PaymentService/CreatePayment'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onImport).toHaveBeenCalledWith({
      serverAddress: 'localhost:50051',
      service: 'PaymentService',
      method: 'CreatePayment',
      message: '',
      metadata: [],
    });
    expect(screen.getByText('Imported.')).toBeInTheDocument();
  });

  it('shows an error and does not call onImport for an invalid command', async () => {
    const onImport = vi.fn();
    render(<PasteGrpcurlPanel onImport={onImport} />);
    await userEvent.type(screen.getByLabelText('grpcurl command'), 'not a grpcurl command');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.getByText('Command must start with "grpcurl"')).toBeInTheDocument();
  });

  it('keeps the textarea text after a successful import', async () => {
    render(<PasteGrpcurlPanel onImport={vi.fn()} />);
    const textarea = screen.getByLabelText('grpcurl command');
    await userEvent.type(textarea, 'grpcurl localhost:50051 payment.PaymentService/CreatePayment');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(textarea).toHaveValue('grpcurl localhost:50051 payment.PaymentService/CreatePayment');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `../../src/components/PasteGrpcurlPanel` does not exist.

- [ ] **Step 3: Implement `PasteGrpcurlPanel`**

Create `packages/web/src/components/PasteGrpcurlPanel.tsx`:

```tsx
import { useState } from 'react';
import type { KeyValueRow } from '../types';
import { parseGrpcurl } from '../grpcurl';

export interface PasteGrpcurlPanelResult {
  serverAddress: string;
  service: string;
  method: string;
  message: string;
  metadata: KeyValueRow[];
}

export interface PasteGrpcurlPanelProps {
  onImport: (result: PasteGrpcurlPanelResult) => void;
}

export function PasteGrpcurlPanel({ onImport }: PasteGrpcurlPanelProps) {
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  function handleImport() {
    const result = parseGrpcurl(text);
    if (result.ok) {
      onImport({
        serverAddress: result.serverAddress,
        service: result.service,
        method: result.method,
        message: result.message,
        metadata: result.metadata,
      });
      setFeedback({ type: 'success', text: 'Imported.' });
    } else {
      setFeedback({ type: 'error', text: result.error });
    }
  }

  return (
    <fieldset className="card">
      <legend className="heading-sm">Paste grpcurl</legend>
      <label className="label">
        grpcurl command
        <textarea className="code-input" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <button
        type="button"
        className="btn-secondary"
        disabled={text.trim() === ''}
        onClick={handleImport}
      >
        Import
      </button>
      {feedback && (
        <p className={feedback.type === 'error' ? 'alert' : 'alert alert--success'}>{feedback.text}</p>
      )}
    </fieldset>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including the 4 new ones).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/components/PasteGrpcurlPanel.tsx packages/web/test/components/PasteGrpcurlPanel.test.tsx
git commit -m "feat(web): add PasteGrpcurlPanel component"
```

---

### Task 8: `FormState` + `dsl.ts` protocol branching

**Files:**
- Modify: `packages/web/src/types.ts`
- Modify: `packages/web/src/dsl.ts`
- Modify: `packages/web/test/dsl.test.ts`
- Modify: `packages/web/test/steps.test.ts`
- Modify: `packages/web/test/components/RunButton.test.tsx`
- Modify: `packages/web/test/components/FlowRunner.test.tsx`
- Modify: `packages/web/test/components/SaveStepButton.test.tsx`
- Modify: `packages/web/test/components/LoadStepSelect.test.tsx`
- Modify: `packages/web/src/App.tsx` (`initialForm` only — the rest of `App.tsx` is Task 10)

**Interfaces:**
- Produces: `Protocol` (`'rest' | 'grpc'`), `GrpcFormState` (`{ protoContent: string; protoFilename: string; serverAddress: string; service: string; method: string; requestMessage: string; metadata: KeyValueRow[] }`), `FormState` gains `protocol: Protocol` and `grpc: GrpcFormState`. `buildTaskSteps(form: FormState): Step[]`, `buildFlowDefinition(forms: FormState[]): TestDefinition` both now branch on `form.protocol`. Consumed by `RequestBuilder` (Task 9) and `App` (Task 10).

This task widens a type with only required fields, so every place that builds a `FormState` object literal must be updated in this same task or the workspace won't typecheck. This task's own tests are extensions of the *existing* `dsl.test.ts` suite; the other five test files just need their helper functions updated so they keep compiling and passing exactly as before.

- [ ] **Step 1: Widen `FormState` in `types.ts`**

In `packages/web/src/types.ts`, change:

```ts
export interface FormState {
  actorName: string;
  taskName: string;
  variables: KeyValueRow[];
  method: string;
  url: string;
  params: KeyValueRow[];
  headers: KeyValueRow[];
  auth: AuthConfig;
  body: string;
  extracts: ExtractRow[];
  questions: QuestionRow[];
}
```

to:

```ts
export type Protocol = 'rest' | 'grpc';

export interface GrpcFormState {
  protoContent: string;
  protoFilename: string;
  serverAddress: string;
  service: string;
  method: string;
  requestMessage: string;
  metadata: KeyValueRow[];
}

export interface FormState {
  actorName: string;
  taskName: string;
  variables: KeyValueRow[];
  protocol: Protocol;
  method: string;
  url: string;
  params: KeyValueRow[];
  headers: KeyValueRow[];
  auth: AuthConfig;
  body: string;
  grpc: GrpcFormState;
  extracts: ExtractRow[];
  questions: QuestionRow[];
}
```

- [ ] **Step 2: Write failing tests for `buildFlowDefinition`'s protocol branching**

In `packages/web/test/dsl.test.ts`, change the `emptyForm` helper:

```ts
function emptyForm(overrides: Partial<FormState> = {}): FormState {
  return {
    actorName: 'Authenticated Customer',
    taskName: 'Create Payment',
    variables: [],
    method: 'GET',
    url: 'https://api.example.com',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    extracts: [],
    questions: [],
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
    ...overrides,
  };
}

function emptyForm(overrides: Partial<FormState> = {}): FormState {
  return {
    actorName: 'Authenticated Customer',
    taskName: 'Create Payment',
    variables: [],
    protocol: 'rest',
    method: 'GET',
    url: 'https://api.example.com',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    grpc: emptyGrpc(),
    extracts: [],
    questions: [],
    ...overrides,
  };
}
```

Then add this block at the very end of the file, right after the closing `});` of the existing `describe('buildFlowDefinition', ...)` block:

```ts

describe('buildTaskSteps with protocol: grpc', () => {
  it('builds a grpc interaction step from the grpc sub-object', () => {
    const steps = buildTestDefinition(
      emptyForm({
        protocol: 'grpc',
        grpc: emptyGrpc({
          protoContent: 'syntax = "proto3";',
          serverAddress: 'localhost:50051',
          service: 'PaymentService',
          method: 'CreatePayment',
          requestMessage: '{"amount":"100"}',
          metadata: [{ id: '1', key: 'x-request-id', value: 'abc' }],
        }),
      })
    ).tasks[0].steps;
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
    expect(steps[1]).toEqual({ type: 'extract', runner: 'grpc', action: 'raw', remember: HIDDEN_RESPONSE_VARIABLE });
  });

  it('defaults an empty requestMessage to an empty object', () => {
    const steps = buildTestDefinition(emptyForm({ protocol: 'grpc', grpc: emptyGrpc() })).tasks[0].steps;
    const interactionStep = steps[0] as { with: { message: unknown } };
    expect(interactionStep.with.message).toEqual({});
  });

  it('tags extract and question steps with the grpc runner too', () => {
    const definition = buildTestDefinition(
      emptyForm({
        protocol: 'grpc',
        grpc: emptyGrpc(),
        extracts: [{ id: '1', source: 'jsonPath', path: '$.paymentId', rememberAs: 'paymentId' }],
        questions: [{ id: '1', source: 'status', path: '', expected: '0' }],
      })
    );
    expect(definition.tasks[0].steps[2]).toMatchObject({ type: 'extract', runner: 'grpc' });
    expect(definition.tasks[0].steps[3]).toMatchObject({ type: 'question', runner: 'grpc' });
  });
});

describe('buildFlowDefinition with mixed protocols', () => {
  it('tags each task with its own form protocol runner', () => {
    const definition = buildFlowDefinition([
      emptyForm({ protocol: 'rest', taskName: 'Check Balance' }),
      emptyForm({ protocol: 'grpc', taskName: 'Transfer Money', grpc: emptyGrpc() }),
    ]);
    expect(definition.tasks[0].steps[0]).toMatchObject({ runner: 'rest' });
    expect(definition.tasks[1].steps[0]).toMatchObject({ runner: 'grpc' });
  });

  it('sets abilities to the unique set of protocols used across the flow', () => {
    const definition = buildFlowDefinition([
      emptyForm({ protocol: 'rest' }),
      emptyForm({ protocol: 'grpc', grpc: emptyGrpc() }),
    ]);
    expect(definition.actor.abilities).toEqual(['rest', 'grpc']);
  });
});
```

- [ ] **Step 3: Run the tests to verify the new ones fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `dsl.test.ts`'s new tests fail (protocol branching doesn't exist yet); every OTHER test file that builds a `FormState` literal fails to *compile* at this point too (missing `protocol`/`grpc` fields) — that's expected and fixed in the next step.

- [ ] **Step 4: Implement the protocol branching in `dsl.ts`**

Replace the entire contents of `packages/web/src/dsl.ts` with:

```ts
import type { Step, TestDefinition } from '@ai-native-testing/engine';
import type { AuthConfig, FormState, KeyValueRow, SourceKind } from './types';

export const HIDDEN_RESPONSE_VARIABLE = '__response';

function rowsToRecord(rows: KeyValueRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim() !== '') {
      result[row.key] = row.value;
    }
  }
  return result;
}

function authToDsl(auth: AuthConfig): Record<string, unknown> | undefined {
  switch (auth.type) {
    case 'none':
      return undefined;
    case 'bearer':
      return { type: 'bearer', token: auth.token };
    case 'apiKey':
      return { type: 'apiKey', header: auth.header, value: auth.value };
    case 'basic':
      return { type: 'basic', username: auth.username, password: auth.password };
  }
}

function sourceToStepFields(
  source: SourceKind,
  path: string
): { action: string; with?: Record<string, unknown> } {
  switch (source) {
    case 'status':
      return { action: 'status' };
    case 'header':
      return { action: 'header', with: { name: path } };
    case 'jsonPath':
      return { action: 'jsonPath', with: { path } };
  }
}

function parseExpected(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function buildRestRequestWith(form: FormState): Record<string, unknown> {
  const requestWith: Record<string, unknown> = {
    method: form.method,
    url: form.url,
  };
  const params = rowsToRecord(form.params);
  if (Object.keys(params).length > 0) {
    requestWith.query = params;
  }
  const headers = rowsToRecord(form.headers);
  if (Object.keys(headers).length > 0) {
    requestWith.headers = headers;
  }
  const auth = authToDsl(form.auth);
  if (auth) {
    requestWith.auth = auth;
  }
  if (form.body.trim() !== '') {
    requestWith.body = JSON.parse(form.body);
  }
  return requestWith;
}

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

export function buildTaskSteps(form: FormState): Step[] {
  const runner = form.protocol === 'grpc' ? 'grpc' : 'rest';
  return [
    buildInteractionStep(form),
    { type: 'extract', runner, action: 'raw', remember: HIDDEN_RESPONSE_VARIABLE },
    ...form.extracts.map((row): Step => {
      const { action, with: withFields } = sourceToStepFields(row.source, row.path);
      return { type: 'extract', runner, action, with: withFields, remember: row.rememberAs };
    }),
    ...form.questions.map((row): Step => {
      const { action, with: withFields } = sourceToStepFields(row.source, row.path);
      return {
        type: 'question',
        runner,
        action,
        with: withFields,
        expect: { equals: parseExpected(row.expected) },
      };
    }),
  ];
}

export function buildTestDefinition(form: FormState): TestDefinition {
  const variables = rowsToRecord(form.variables);

  return {
    actor: { name: form.actorName, abilities: [form.protocol] },
    variables: Object.keys(variables).length > 0 ? variables : undefined,
    tasks: [{ name: form.taskName, steps: buildTaskSteps(form) }],
  };
}

export function buildFlowDefinition(forms: FormState[]): TestDefinition {
  const mergedVariables: Record<string, string> = {};
  for (const form of forms) {
    Object.assign(mergedVariables, rowsToRecord(form.variables));
  }
  const abilities = Array.from(new Set(forms.map((form) => form.protocol)));

  return {
    actor: { name: forms[0].actorName, abilities },
    variables: Object.keys(mergedVariables).length > 0 ? mergedVariables : undefined,
    tasks: forms.map((form) => ({ name: form.taskName, steps: buildTaskSteps(form) })),
  };
}
```

- [ ] **Step 5: Fix every other `FormState`-literal-building test helper**

In `packages/web/test/steps.test.ts`, change:

```ts
function sampleForm(): FormState {
  return {
    actorName: 'Customer',
    taskName: 'Create Payment',
    variables: [],
    method: 'POST',
    url: 'https://api.example.com/x',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    extracts: [],
    questions: [],
  };
}
```

to:

```ts
function sampleForm(): FormState {
  return {
    actorName: 'Customer',
    taskName: 'Create Payment',
    variables: [],
    protocol: 'rest',
    method: 'POST',
    url: 'https://api.example.com/x',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    grpc: {
      protoContent: '',
      protoFilename: '',
      serverAddress: '',
      service: '',
      method: '',
      requestMessage: '',
      metadata: [],
    },
    extracts: [],
    questions: [],
  };
}
```

In `packages/web/test/components/RunButton.test.tsx`, change:

```ts
function emptyForm(): FormState {
  return {
    actorName: 'Actor',
    taskName: 'Task',
    variables: [],
    method: 'GET',
    url: 'https://api.example.com',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    extracts: [],
    questions: [],
  };
}
```

to:

```ts
function emptyForm(): FormState {
  return {
    actorName: 'Actor',
    taskName: 'Task',
    variables: [],
    protocol: 'rest',
    method: 'GET',
    url: 'https://api.example.com',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    grpc: {
      protoContent: '',
      protoFilename: '',
      serverAddress: '',
      service: '',
      method: '',
      requestMessage: '',
      metadata: [],
    },
    extracts: [],
    questions: [],
  };
}
```

In `packages/web/test/components/FlowRunner.test.tsx`, change:

```ts
function sampleForm(overrides: Partial<FormState> = {}): FormState {
  return {
    actorName: 'Authenticated Customer',
    taskName: 'Check Balance',
    variables: [],
    method: 'GET',
    url: 'https://api.example.com/balance',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    extracts: [],
    questions: [],
    ...overrides,
  };
}
```

to:

```ts
function sampleForm(overrides: Partial<FormState> = {}): FormState {
  return {
    actorName: 'Authenticated Customer',
    taskName: 'Check Balance',
    variables: [],
    protocol: 'rest',
    method: 'GET',
    url: 'https://api.example.com/balance',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    grpc: {
      protoContent: '',
      protoFilename: '',
      serverAddress: '',
      service: '',
      method: '',
      requestMessage: '',
      metadata: [],
    },
    extracts: [],
    questions: [],
    ...overrides,
  };
}
```

In `packages/web/test/components/SaveStepButton.test.tsx`, change:

```ts
function sampleForm(): FormState {
  return {
    actorName: '',
    taskName: 'Create Payment',
    variables: [],
    method: 'POST',
    url: 'https://api.example.com/x',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    extracts: [],
    questions: [],
  };
}
```

to:

```ts
function sampleForm(): FormState {
  return {
    actorName: '',
    taskName: 'Create Payment',
    variables: [],
    protocol: 'rest',
    method: 'POST',
    url: 'https://api.example.com/x',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    grpc: {
      protoContent: '',
      protoFilename: '',
      serverAddress: '',
      service: '',
      method: '',
      requestMessage: '',
      metadata: [],
    },
    extracts: [],
    questions: [],
  };
}
```

In `packages/web/test/components/LoadStepSelect.test.tsx`, change:

```ts
function sampleForm(): FormState {
  return {
    actorName: 'Customer',
    taskName: 'Create Payment',
    variables: [],
    method: 'POST',
    url: 'https://api.example.com/x',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    extracts: [],
    questions: [],
  };
}
```

to:

```ts
function sampleForm(): FormState {
  return {
    actorName: 'Customer',
    taskName: 'Create Payment',
    variables: [],
    protocol: 'rest',
    method: 'POST',
    url: 'https://api.example.com/x',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    grpc: {
      protoContent: '',
      protoFilename: '',
      serverAddress: '',
      service: '',
      method: '',
      requestMessage: '',
      metadata: [],
    },
    extracts: [],
    questions: [],
  };
}
```

In `packages/web/src/App.tsx`, change:

```tsx
function initialForm(): FormState {
  return {
    actorName: '',
    taskName: '',
    variables: [],
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    extracts: [],
    questions: [],
  };
}
```

to:

```tsx
function initialForm(): FormState {
  return {
    actorName: '',
    taskName: '',
    variables: [],
    protocol: 'rest',
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    grpc: {
      protoContent: '',
      protoFilename: '',
      serverAddress: '',
      service: '',
      method: '',
      requestMessage: '',
      metadata: [],
    },
    extracts: [],
    questions: [],
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including the 5 new `dsl.test.ts` tests — every other file's tests pass unchanged now that their helpers compile again).

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/types.ts packages/web/src/dsl.ts packages/web/test/dsl.test.ts packages/web/test/steps.test.ts packages/web/test/components/RunButton.test.tsx packages/web/test/components/FlowRunner.test.tsx packages/web/test/components/SaveStepButton.test.tsx packages/web/test/components/LoadStepSelect.test.tsx packages/web/src/App.tsx
git commit -m "feat(web): widen FormState with protocol/grpc fields and branch dsl.ts accordingly"
```

---

### Task 9: `RequestBuilder` gRPC UI

**Files:**
- Modify: `packages/web/src/components/RequestBuilder.tsx`
- Modify: `packages/web/test/components/RequestBuilder.test.tsx`

**Interfaces:**
- Consumes: `introspectProto` (Task 5), `PasteGrpcurlPanel` (Task 7), `Protocol`/`GrpcFormState` (Task 8).
- Produces: `RequestBuilderProps` gains `protocol: Protocol`, `onProtocolChange: (protocol: Protocol) => void`, `grpc: GrpcFormState`, `onGrpcChange: (grpc: GrpcFormState) => void`. Consumed by `App` (Task 10).

- [ ] **Step 1: Write failing tests**

In `packages/web/test/components/RequestBuilder.test.tsx`, change the imports:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestBuilder, type RequestBuilderProps } from '../../src/components/RequestBuilder';
import type { AuthConfig } from '../../src/types';
```

to:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestBuilder, type RequestBuilderProps } from '../../src/components/RequestBuilder';
import type { AuthConfig, GrpcFormState } from '../../src/types';
```

Change the `baseProps` helper:

```tsx
function baseProps(overrides: Partial<RequestBuilderProps> = {}): RequestBuilderProps {
  return {
    method: 'GET',
    onMethodChange: vi.fn(),
    url: '',
    onUrlChange: vi.fn(),
    params: [],
    onParamsChange: vi.fn(),
    headers: [],
    onHeadersChange: vi.fn(),
    auth: { type: 'none' } as AuthConfig,
    onAuthChange: vi.fn(),
    body: '',
    onBodyChange: vi.fn(),
    extracts: [],
    onExtractsChange: vi.fn(),
    questions: [],
    onQuestionsChange: vi.fn(),
    ...overrides,
  };
}
```

to:

```tsx
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

function baseProps(overrides: Partial<RequestBuilderProps> = {}): RequestBuilderProps {
  return {
    protocol: 'rest',
    onProtocolChange: vi.fn(),
    method: 'GET',
    onMethodChange: vi.fn(),
    url: '',
    onUrlChange: vi.fn(),
    params: [],
    onParamsChange: vi.fn(),
    headers: [],
    onHeadersChange: vi.fn(),
    auth: { type: 'none' } as AuthConfig,
    onAuthChange: vi.fn(),
    body: '',
    onBodyChange: vi.fn(),
    grpc: blankGrpc(),
    onGrpcChange: vi.fn(),
    extracts: [],
    onExtractsChange: vi.fn(),
    questions: [],
    onQuestionsChange: vi.fn(),
    ...overrides,
  };
}
```

Add an `afterEach` right after the `baseProps` function (needed for the fetch-stubbing gRPC tests below):

```tsx
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
```

Then add this block at the end of the file, right before the final closing `});` of the `describe('RequestBuilder', ...)` block:

```tsx

  it('calls onProtocolChange when the Protocol select changes', async () => {
    const onProtocolChange = vi.fn();
    render(<RequestBuilder {...baseProps({ onProtocolChange })} />);
    await userEvent.selectOptions(screen.getByLabelText('Protocol'), 'grpc');
    expect(onProtocolChange).toHaveBeenCalledWith('grpc');
  });

  it('shows gRPC tabs and hides Paste cURL when protocol is grpc', () => {
    render(<RequestBuilder {...baseProps({ protocol: 'grpc' })} />);
    expect(screen.getByRole('button', { name: 'Proto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Service' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Method' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Metadata' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paste grpcurl' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Paste cURL' })).not.toBeInTheDocument();
  });

  it('shows Server Address instead of Method/URL when protocol is grpc', async () => {
    const onGrpcChange = vi.fn();
    render(<RequestBuilder {...baseProps({ protocol: 'grpc', onGrpcChange })} />);
    expect(screen.queryByLabelText('Method')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('URL')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Server Address'), 'x');
    expect(onGrpcChange).toHaveBeenCalledWith(expect.objectContaining({ serverAddress: 'x' }));
  });

  it('uploading a .proto file introspects it and populates the Service datalist', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ services: [{ service: 'PaymentService', methods: ['CreatePayment', 'GetPayment'] }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const onGrpcChange = vi.fn();
    render(<RequestBuilder {...baseProps({ protocol: 'grpc', onGrpcChange })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Proto' }));
    const file = new File(['syntax = "proto3";'], 'payment.proto', { type: 'text/plain' });
    await userEvent.upload(screen.getByLabelText('Proto File'), file);

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/grpc/introspect', expect.objectContaining({ method: 'POST' }))
    );
    expect(onGrpcChange).toHaveBeenCalledWith(
      expect.objectContaining({ protoContent: 'syntax = "proto3";', protoFilename: 'payment.proto' })
    );

    await userEvent.click(screen.getByRole('button', { name: 'Service' }));
    await vi.waitFor(() => {
      const options = document.querySelectorAll('#grpc-service-options option');
      expect(Array.from(options).map((o) => o.getAttribute('value'))).toEqual(['PaymentService']);
    });
  });

  it('filters Method suggestions to the currently selected Service', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          services: [
            { service: 'PaymentService', methods: ['CreatePayment', 'GetPayment'] },
            { service: 'UserService', methods: ['GetUser'] },
          ],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <RequestBuilder
        {...baseProps({ protocol: 'grpc', grpc: { ...blankGrpc(), service: 'PaymentService' } })}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Proto' }));
    const file = new File(['syntax = "proto3";'], 'payment.proto', { type: 'text/plain' });
    await userEvent.upload(screen.getByLabelText('Proto File'), file);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'Method' }));
    await vi.waitFor(() => {
      const options = document.querySelectorAll('#grpc-method-options option');
      expect(Array.from(options).map((o) => o.getAttribute('value'))).toEqual(['CreatePayment', 'GetPayment']);
    });
  });

  it('switches to the Paste grpcurl tab and applies a successful import', async () => {
    const onGrpcChange = vi.fn();
    render(<RequestBuilder {...baseProps({ protocol: 'grpc', onGrpcChange })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Paste grpcurl' }));
    fireEvent.change(screen.getByLabelText('grpcurl command'), {
      target: { value: 'grpcurl localhost:50051 payment.PaymentService/CreatePayment' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onGrpcChange).toHaveBeenCalledWith(
      expect.objectContaining({
        serverAddress: 'localhost:50051',
        service: 'PaymentService',
        method: 'CreatePayment',
      })
    );
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `RequestBuilder` doesn't accept `protocol`/`grpc` props yet, and none of the gRPC UI exists.

- [ ] **Step 3: Implement the gRPC UI in `RequestBuilder`**

Replace the entire contents of `packages/web/src/components/RequestBuilder.tsx` with:

```tsx
import { useState } from 'react';
import type { AuthConfig, ExtractRow, GrpcFormState, KeyValueRow, Protocol, QuestionRow } from '../types';
import { KeyValueRows } from './KeyValueRows';
import { ExtractEditor } from './ExtractEditor';
import { QuestionsEditor } from './QuestionsEditor';
import { CurlImport } from './CurlImport';
import { PasteGrpcurlPanel } from './PasteGrpcurlPanel';
import { introspectProto, type ServiceDefinition } from '../grpcIntrospect';

export interface RequestBuilderProps {
  protocol: Protocol;
  onProtocolChange: (protocol: Protocol) => void;
  method: string;
  onMethodChange: (method: string) => void;
  url: string;
  onUrlChange: (url: string) => void;
  params: KeyValueRow[];
  onParamsChange: (rows: KeyValueRow[]) => void;
  headers: KeyValueRow[];
  onHeadersChange: (rows: KeyValueRow[]) => void;
  auth: AuthConfig;
  onAuthChange: (auth: AuthConfig) => void;
  body: string;
  onBodyChange: (body: string) => void;
  grpc: GrpcFormState;
  onGrpcChange: (grpc: GrpcFormState) => void;
  extracts: ExtractRow[];
  onExtractsChange: (rows: ExtractRow[]) => void;
  questions: QuestionRow[];
  onQuestionsChange: (rows: QuestionRow[]) => void;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const AUTH_TYPES = ['none', 'bearer', 'apiKey', 'basic'] as const;
const PROTOCOLS: { id: Protocol; label: string }[] = [
  { id: 'rest', label: 'REST' },
  { id: 'grpc', label: 'gRPC' },
];

type RestTab = 'params' | 'headers' | 'auth' | 'body' | 'curl' | 'extract' | 'questions';
type GrpcTab = 'proto' | 'service' | 'method' | 'message' | 'metadata' | 'grpcurl' | 'extract' | 'questions';

const REST_TABS: { id: RestTab; label: string }[] = [
  { id: 'params', label: 'Params' },
  { id: 'headers', label: 'Headers' },
  { id: 'auth', label: 'Auth' },
  { id: 'body', label: 'Body' },
  { id: 'curl', label: 'Paste cURL' },
  { id: 'extract', label: 'Extract' },
  { id: 'questions', label: 'Questions' },
];

const GRPC_TABS: { id: GrpcTab; label: string }[] = [
  { id: 'proto', label: 'Proto' },
  { id: 'service', label: 'Service' },
  { id: 'method', label: 'Method' },
  { id: 'message', label: 'Message' },
  { id: 'metadata', label: 'Metadata' },
  { id: 'grpcurl', label: 'Paste grpcurl' },
  { id: 'extract', label: 'Extract' },
  { id: 'questions', label: 'Questions' },
];

function blankAuth(type: (typeof AUTH_TYPES)[number]): AuthConfig {
  switch (type) {
    case 'none':
      return { type: 'none' };
    case 'bearer':
      return { type: 'bearer', token: '' };
    case 'apiKey':
      return { type: 'apiKey', header: '', value: '' };
    case 'basic':
      return { type: 'basic', username: '', password: '' };
  }
}

export function RequestBuilder(props: RequestBuilderProps) {
  const {
    protocol,
    onProtocolChange,
    method,
    onMethodChange,
    url,
    onUrlChange,
    params,
    onParamsChange,
    headers,
    onHeadersChange,
    auth,
    onAuthChange,
    body,
    onBodyChange,
    grpc,
    onGrpcChange,
    extracts,
    onExtractsChange,
    questions,
    onQuestionsChange,
  } = props;

  const [restTab, setRestTab] = useState<RestTab>('params');
  const [grpcTab, setGrpcTab] = useState<GrpcTab>('proto');
  const [services, setServices] = useState<ServiceDefinition[]>([]);
  const [protoError, setProtoError] = useState<string | null>(null);

  async function handleProtoFile(file: File) {
    const content = await file.text();
    onGrpcChange({ ...grpc, protoContent: content, protoFilename: file.name });
    const result = await introspectProto(content);
    if (result) {
      setServices(result);
      setProtoError(null);
    } else {
      setServices([]);
      setProtoError('Could not parse this .proto file.');
    }
  }

  const methodSuggestions = services.find((s) => s.service === grpc.service)?.methods ?? [];

  return (
    <section className="card">
      <h2 className="heading-md">Request</h2>
      <div className="row">
        <label className="label">
          Protocol
          <select
            className="text-input"
            value={protocol}
            onChange={(e) => onProtocolChange(e.target.value as Protocol)}
          >
            {PROTOCOLS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {protocol === 'rest' ? (
          <>
            <label className="label">
              Method
              <select
                className="text-input"
                value={method}
                onChange={(e) => onMethodChange(e.target.value)}
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              URL
              <input className="text-input" value={url} onChange={(e) => onUrlChange(e.target.value)} />
            </label>
          </>
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

      {protocol === 'rest' ? (
        <>
          <nav className="tab-bar">
            {REST_TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className="tab"
                aria-current={restTab === id}
                onClick={() => setRestTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          {restTab === 'params' && <KeyValueRows label="Params" rows={params} onChange={onParamsChange} />}
          {restTab === 'headers' && <KeyValueRows label="Headers" rows={headers} onChange={onHeadersChange} />}
          {restTab === 'auth' && (
            <fieldset className="card">
              <legend className="heading-sm">Auth</legend>
              <label className="label">
                Type
                <select
                  className="text-input"
                  value={auth.type}
                  onChange={(e) => onAuthChange(blankAuth(e.target.value as (typeof AUTH_TYPES)[number]))}
                >
                  {AUTH_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              {auth.type === 'bearer' && (
                <label className="label">
                  Token
                  <input
                    className="text-input"
                    value={auth.token}
                    onChange={(e) => onAuthChange({ type: 'bearer', token: e.target.value })}
                  />
                </label>
              )}
              {auth.type === 'apiKey' && (
                <>
                  <label className="label">
                    Header
                    <input
                      className="text-input"
                      value={auth.header}
                      onChange={(e) =>
                        onAuthChange({ type: 'apiKey', header: e.target.value, value: auth.value })
                      }
                    />
                  </label>
                  <label className="label">
                    Value
                    <input
                      className="text-input"
                      value={auth.value}
                      onChange={(e) =>
                        onAuthChange({ type: 'apiKey', header: auth.header, value: e.target.value })
                      }
                    />
                  </label>
                </>
              )}
              {auth.type === 'basic' && (
                <>
                  <label className="label">
                    Username
                    <input
                      className="text-input"
                      value={auth.username}
                      onChange={(e) =>
                        onAuthChange({ type: 'basic', username: e.target.value, password: auth.password })
                      }
                    />
                  </label>
                  <label className="label">
                    Password
                    <input
                      className="text-input"
                      value={auth.password}
                      onChange={(e) =>
                        onAuthChange({ type: 'basic', username: auth.username, password: e.target.value })
                      }
                    />
                  </label>
                </>
              )}
            </fieldset>
          )}
          {restTab === 'body' && (
            <label className="label">
              Body (JSON)
              <textarea
                className="code-input"
                value={body}
                onChange={(e) => onBodyChange(e.target.value)}
              />
            </label>
          )}
          {restTab === 'curl' && (
            <CurlImport
              onImport={(r) => {
                onMethodChange(r.method);
                onUrlChange(r.url);
                onHeadersChange(r.headers);
                onBodyChange(r.body);
              }}
            />
          )}
          {restTab === 'extract' && <ExtractEditor rows={extracts} onChange={onExtractsChange} />}
          {restTab === 'questions' && <QuestionsEditor rows={questions} onChange={onQuestionsChange} />}
        </>
      ) : (
        <>
          <nav className="tab-bar">
            {GRPC_TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className="tab"
                aria-current={grpcTab === id}
                onClick={() => setGrpcTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          {grpcTab === 'proto' && (
            <fieldset className="card">
              <legend className="heading-sm">Proto File</legend>
              <label className="label">
                Proto File
                <input
                  className="text-input"
                  type="file"
                  accept=".proto"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleProtoFile(file);
                    }
                  }}
                />
              </label>
              {grpc.protoFilename !== '' && <p className="body-strong">{grpc.protoFilename}</p>}
              {protoError && <p className="alert">{protoError}</p>}
            </fieldset>
          )}
          {grpcTab === 'service' && (
            <label className="label">
              Service
              <input
                className="text-input"
                list="grpc-service-options"
                value={grpc.service}
                onChange={(e) => onGrpcChange({ ...grpc, service: e.target.value })}
              />
              <datalist id="grpc-service-options">
                {services.map((s) => (
                  <option key={s.service} value={s.service} />
                ))}
              </datalist>
            </label>
          )}
          {grpcTab === 'method' && (
            <label className="label">
              Method
              <input
                className="text-input"
                list="grpc-method-options"
                value={grpc.method}
                onChange={(e) => onGrpcChange({ ...grpc, method: e.target.value })}
              />
              <datalist id="grpc-method-options">
                {methodSuggestions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
          )}
          {grpcTab === 'message' && (
            <label className="label">
              Message (JSON)
              <textarea
                className="code-input"
                value={grpc.requestMessage}
                onChange={(e) => onGrpcChange({ ...grpc, requestMessage: e.target.value })}
              />
            </label>
          )}
          {grpcTab === 'metadata' && (
            <KeyValueRows
              label="Metadata"
              rows={grpc.metadata}
              onChange={(metadata) => onGrpcChange({ ...grpc, metadata })}
            />
          )}
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
          {grpcTab === 'extract' && <ExtractEditor rows={extracts} onChange={onExtractsChange} />}
          {grpcTab === 'questions' && <QuestionsEditor rows={questions} onChange={onQuestionsChange} />}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including the 6 new gRPC-related ones — every existing REST-mode test still passes unchanged).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/components/RequestBuilder.tsx packages/web/test/components/RequestBuilder.test.tsx
git commit -m "feat(web): add Protocol toggle and gRPC tabs to RequestBuilder"
```

---

### Task 10: `App` integration

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/vite.config.ts`

**Interfaces:**
- Consumes: `RequestBuilder`'s widened props (Task 9).
- Produces: nothing new for later tasks — this is the final integration point for this feature.

- [ ] **Step 1: Add the gRPC-aware validation branch and wire the new props**

In `packages/web/src/App.tsx`, change `isFormValid`:

```tsx
function isFormValid(form: FormState): boolean {
  if (form.taskName.trim() === '' || form.url.trim() === '') {
    return false;
  }
  if (!isBodyValid(form.body)) {
    return false;
  }
  for (const row of form.extracts) {
    if (row.source !== 'status' && row.path.trim() === '') return false;
    if (row.rememberAs.trim() === '') return false;
  }
  for (const row of form.questions) {
    if (row.source !== 'status' && row.path.trim() === '') return false;
    if (row.expected.trim() === '') return false;
  }
  return true;
}
```

to:

```tsx
function isGrpcMessageValid(requestMessage: string): boolean {
  if (requestMessage.trim() === '') {
    return true;
  }
  try {
    JSON.parse(requestMessage);
    return true;
  } catch {
    return false;
  }
}

function isFormValid(form: FormState): boolean {
  if (form.taskName.trim() === '') {
    return false;
  }
  if (form.protocol === 'grpc') {
    if (
      form.grpc.serverAddress.trim() === '' ||
      form.grpc.service.trim() === '' ||
      form.grpc.method.trim() === '' ||
      form.grpc.protoContent.trim() === ''
    ) {
      return false;
    }
    if (!isGrpcMessageValid(form.grpc.requestMessage)) {
      return false;
    }
  } else {
    if (form.url.trim() === '') {
      return false;
    }
    if (!isBodyValid(form.body)) {
      return false;
    }
  }
  for (const row of form.extracts) {
    if (row.source !== 'status' && row.path.trim() === '') return false;
    if (row.rememberAs.trim() === '') return false;
  }
  for (const row of form.questions) {
    if (row.source !== 'status' && row.path.trim() === '') return false;
    if (row.expected.trim() === '') return false;
  }
  return true;
}
```

Change the `<RequestBuilder ... />` element:

```tsx
      <RequestBuilder
        method={form.method}
        onMethodChange={(method) => setForm((prev) => ({ ...prev, method }))}
        url={form.url}
        onUrlChange={(url) => setForm((prev) => ({ ...prev, url }))}
        params={form.params}
        onParamsChange={(params) => setForm((prev) => ({ ...prev, params }))}
        headers={form.headers}
        onHeadersChange={(headers) => setForm((prev) => ({ ...prev, headers }))}
        auth={form.auth}
        onAuthChange={(auth) => setForm((prev) => ({ ...prev, auth }))}
        body={form.body}
        onBodyChange={(body) => setForm((prev) => ({ ...prev, body }))}
        extracts={form.extracts}
        onExtractsChange={(extracts) => setForm((prev) => ({ ...prev, extracts }))}
        questions={form.questions}
        onQuestionsChange={(questions) => setForm((prev) => ({ ...prev, questions }))}
      />
```

to:

```tsx
      <RequestBuilder
        protocol={form.protocol}
        onProtocolChange={(protocol) => setForm((prev) => ({ ...prev, protocol }))}
        method={form.method}
        onMethodChange={(method) => setForm((prev) => ({ ...prev, method }))}
        url={form.url}
        onUrlChange={(url) => setForm((prev) => ({ ...prev, url }))}
        params={form.params}
        onParamsChange={(params) => setForm((prev) => ({ ...prev, params }))}
        headers={form.headers}
        onHeadersChange={(headers) => setForm((prev) => ({ ...prev, headers }))}
        auth={form.auth}
        onAuthChange={(auth) => setForm((prev) => ({ ...prev, auth }))}
        body={form.body}
        onBodyChange={(body) => setForm((prev) => ({ ...prev, body }))}
        grpc={form.grpc}
        onGrpcChange={(grpc) => setForm((prev) => ({ ...prev, grpc }))}
        extracts={form.extracts}
        onExtractsChange={(extracts) => setForm((prev) => ({ ...prev, extracts }))}
        questions={form.questions}
        onQuestionsChange={(questions) => setForm((prev) => ({ ...prev, questions }))}
      />
```

- [ ] **Step 2: Add `/grpc` to the Vite dev proxy**

In `packages/web/vite.config.ts`, change:

```ts
      '/steps': 'http://localhost:3000',
      '/flows': 'http://localhost:3000',
    },
```

to:

```ts
      '/steps': 'http://localhost:3000',
      '/flows': 'http://localhost:3000',
      '/grpc': 'http://localhost:3000',
    },
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests unchanged — `App.test.tsx` doesn't construct gRPC-specific scenarios, and the widened props don't affect its existing REST-only flows).

- [ ] **Step 4: Typecheck, run the whole workspace, and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

Run: `pnpm test && pnpm typecheck`
Expected: PASS across all packages (`engine`, `runner-api`, `runner-grpc`, `runner-log`, `server`, `web`).

```bash
git add packages/web/src/App.tsx packages/web/vite.config.ts
git commit -m "feat(web): wire gRPC protocol validation and RequestBuilder props into App"
```

---

### Task 11: Mixed REST+gRPC E2E Flow test

**Files:**
- Create: `packages/server/test/mixed-flow.test.ts`

**Interfaces:**
- Consumes: `startFakePaymentGrpcServer` (Task 3), `buildApp` (existing).

- [ ] **Step 1: Write the end-to-end test**

Create `packages/server/test/mixed-flow.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { buildApp } from '../src/app.js';
import { startFakePaymentGrpcServer, type FakeGrpcServer } from '@ai-native-testing/runner-grpc';

interface FakeHttpServer {
  url: string;
  close: () => Promise<void>;
}

async function startFakeAuthApi(): Promise<FakeHttpServer> {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && req.url === '/login') {
      res.writeHead(200);
      res.end(JSON.stringify({ data: { customerId: 'CUS001' } }));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('failed to determine fake auth API address');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function pollUntilFinished(app: ReturnType<typeof buildApp>, jobId: string) {
  for (let i = 0; i < 50; i++) {
    const res = await app.inject({ method: 'GET', url: `/runs/${jobId}` });
    const body = res.json();
    if (body.status === 'passed' || body.status === 'failed') {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('job did not finish in time');
}

describe('Mixed REST + gRPC flow end-to-end', () => {
  let httpApi: FakeHttpServer | undefined;
  let grpcServer: FakeGrpcServer | undefined;

  afterEach(async () => {
    await httpApi?.close();
    await grpcServer?.close();
    httpApi = undefined;
    grpcServer = undefined;
  });

  it('runs a REST login step followed by a gRPC payment step, chaining the extracted customerId', async () => {
    httpApi = await startFakeAuthApi();
    grpcServer = await startFakePaymentGrpcServer();
    const app = buildApp();

    const definition = {
      actor: { name: 'Authenticated Customer', abilities: ['rest', 'grpc'] },
      variables: { authBaseUrl: httpApi.url },
      tasks: [
        {
          name: 'Login',
          steps: [
            {
              type: 'interaction',
              runner: 'rest',
              action: 'request',
              with: { method: 'POST', url: '${authBaseUrl}/login', body: {} },
            },
            { type: 'question', runner: 'rest', action: 'status', expect: { equals: 200 } },
            {
              type: 'extract',
              runner: 'rest',
              action: 'jsonPath',
              with: { path: '$.data.customerId' },
              remember: 'customerId',
            },
          ],
        },
        {
          name: 'Create Payment',
          steps: [
            {
              type: 'interaction',
              runner: 'grpc',
              action: 'call',
              with: {
                proto: grpcServer.proto,
                serverAddress: grpcServer.address,
                service: 'PaymentService',
                method: 'CreatePayment',
                message: { amount: '100', customerId: '${customerId}' },
              },
            },
            { type: 'question', runner: 'grpc', action: 'status', expect: { equals: 0 } },
            {
              type: 'question',
              runner: 'grpc',
              action: 'jsonPath',
              with: { path: '$.status' },
              expect: { equals: 'CREATED' },
            },
          ],
        },
      ],
    };

    const submit = await app.inject({ method: 'POST', url: '/runs', payload: definition });
    expect(submit.statusCode).toBe(202);
    const { jobId } = submit.json();

    const job = await pollUntilFinished(app, jobId);
    expect(job.status).toBe('passed');
    expect(job.steps.every((s: { status: string }) => s.status === 'passed')).toBe(true);
  });
});
```

- [ ] **Step 2: Add the `runner-grpc` test dependency and run the test**

`packages/server` already depends on `@ai-native-testing/runner-grpc` from Task 4, so no `package.json` change is needed.

Run: `pnpm --filter @ai-native-testing/server test`
Expected: PASS — this is a real, working mixed-protocol flow proving the `${customerId}` value extracted by the REST task's `jsonPath` extract is correctly available in the gRPC task's request message, through the real dispatcher and both real runners.

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/server typecheck`
Expected: no errors.

```bash
git add packages/server/test/mixed-flow.test.ts
git commit -m "test(server): add mixed REST+gRPC end-to-end flow test"
```

---

### Task 12: Final verification

**Files:** none created or modified — this task only runs checks.

**Interfaces:** none.

- [ ] **Step 1: Run the full workspace test suite and typecheck**

Run: `pnpm test`
Expected: PASS across all 6 packages (`engine`, `runner-api`, `runner-grpc`, `runner-log`, `server`, `web`), no newly failing tests.

Run: `pnpm typecheck`
Expected: no errors in any package.

- [ ] **Step 2: Manual browser verification**

Start the backend (`pnpm --filter @ai-native-testing/server start`) and the GUI dev server (`pnpm --filter @ai-native-testing/web dev`). You'll need a real gRPC server to test against — the simplest option is a short standalone script using `startFakePaymentGrpcServer` from `@ai-native-testing/runner-grpc`, logging its address and proto content, then keeping the process alive (e.g. `node --loader tsx/esm -e "..."` or a throwaway `.ts` file run with `tsx`) so you can point the GUI at it.

In the GUI, confirm:

- Selecting "gRPC" from the Protocol dropdown swaps Method/URL/Params/Headers/Auth/Body/Paste-cURL for Server Address/Proto/Service/Method/Message/Metadata/Paste-grpcurl.
- Uploading the fake server's `.proto` file populates the Service datalist with "PaymentService"; typing/selecting it filters the Method datalist to "CreatePayment"/"GetPayment".
- Filling in Server Address (the fake server's address), Service, Method, and a JSON Message (e.g. `{"amount":"100","customerId":"CUS001"}`), then clicking Run, produces a real response with `status: 0` and the decoded `paymentId`/`status` fields.
- Pasting a `grpcurl` command (matching the fake server) into "Paste grpcurl" correctly populates Server Address/Service/Method/Message/Metadata.
- Saving this gRPC step as a Reusable Step, adding it to a flow alongside a REST step, and running that flow shows both tasks passing in the per-task checklist, with the gRPC task's expanded response rendering correctly (reusing the same `ResultsPanel` REST already uses).

Take a screenshot as evidence, same as prior manual verifications in this project.

- [ ] **Step 3: Commit (if the manual check surfaced any fix)**

If Step 2 finds nothing to fix, there is nothing to commit for this task. If it does surface an issue, fix it, re-run Step 1, and commit:

```bash
git add -A
git commit -m "fix: correct issue found during manual gRPC Runner verification"
```
