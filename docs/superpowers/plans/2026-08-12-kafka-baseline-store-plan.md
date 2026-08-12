# Kafka Baseline Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `capture-baseline.ts`/`update-baseline.ts` — Node-runnable scripts in `packages/web` that run a saved Reusable Step, collect its real Kafka output via Step 1's `collectKafkaMessages`, and save it as a version-controlled baseline file at `kafka-baselines/{version}/{status}.json`.

**Architecture:** A pure, testable core function (`runCapture`) does the actual work (fetch step → build definition → start collecting → trigger the run → return the result); two thin CLI scripts wrap it with argument parsing and file I/O, differing only in overwrite behavior.

**Tech Stack:** TypeScript, `node:util`'s `parseArgs` (no new CLI-parsing dependency), Vitest with mocked `fetch`/`collectKafkaMessages`.

## Global Constraints

- **Already done, verified, and committed** (commit `1faadab`): `packages/web/package.json` has `@ai-native-testing/server` and `kafkajs` as dependencies and `tsx` as a devDependency. Confirmed via a real smoke test that deep-importing specific server files (`@ai-native-testing/server/src/kafka-message-collector.js`, `.../kafka-config.js`, `.../kafka-check-definitions.js`) resolves and typechecks correctly, with **zero import-time side effects**.
- **Never import the bare `@ai-native-testing/server` specifier** anywhere in this feature — its `package.json` `main` field points at `src/index.ts`, which boots a real Fastify server and starts real Kafka consumers as an import-time side effect. Always deep-import the specific file needed.
- **If a capture run times out (`terminatedBy: 'idle-timeout'`) without ever seeing a terminal status, `runCapture` throws** rather than returning an ambiguous result — a baseline is only ever written for a complete, conclusive run. This is a deliberate design decision made during planning (not explicitly spelled out in the approved spec) — flagged here for visibility: an inconclusive capture is a hard failure, not a partial baseline.
- Per-topic `correlatorField` (first entry of `correlatorFields`), `hasDataWrapper`, are resolved from the server's existing `KAFKA_TOPIC_DEFINITIONS[topic]` — not re-specified by the caller. `statusField` is hardcoded to `'status'` (uniform across all three real topics, confirmed via the topic definitions and the real schema file). `terminalStatuses` defaults to `['SUCCESS', 'FAILED', 'PENDING']` and `idleTimeoutMs` defaults to `15000`, both overridable via CLI flags.
- TDD: write the failing tests, run them, confirm the failure, implement, run again, confirm the pass, typecheck, commit.

---

### Task 1: Core capture logic (`runCapture`)

**Files:**
- Create: `packages/web/scripts/baseline-capture-core.ts`
- Test: `packages/web/scripts/baseline-capture-core.test.ts`

**Interfaces:**
- Consumes: `buildTestDefinition` (`../src/dsl.js`), `extractCorrelatorValue` (`../src/kafkaChecks.js`), `type FormState` (`../src/types.js`); `collectKafkaMessages` (`@ai-native-testing/server/src/kafka-message-collector.js`), `loadKafkaConfig` (`@ai-native-testing/server/src/kafka-config.js`), `KAFKA_TOPIC_DEFINITIONS`, `type KafkaTopicKey` (`@ai-native-testing/server/src/kafka-check-definitions.js`).
- Produces:
  ```ts
  export interface RunCaptureOptions {
    serverUrl: string;
    kafkaConfigPath: string;
    stepName: string;
    topic: KafkaTopicKey;
    idleTimeoutMs: number;
    terminalStatuses: string[];
  }

  export interface RunCaptureResult {
    status: string;
    durationMs: number;
    messages: unknown[];
  }

  export async function runCapture(options: RunCaptureOptions): Promise<RunCaptureResult>;
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/web/scripts/baseline-capture-core.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCapture } from './baseline-capture-core.js';
import type { FormState } from '../src/types.js';

const mocks = vi.hoisted(() => {
  return {
    collectKafkaMessages: vi.fn(),
  };
});

vi.mock('@ai-native-testing/server/src/kafka-message-collector.js', () => ({
  collectKafkaMessages: mocks.collectKafkaMessages,
}));

vi.mock('@ai-native-testing/server/src/kafka-config.js', () => ({
  loadKafkaConfig: () => ({
    groupID: 'test-group',
    topics: {
      transLogV1: { brokers: ['broker:9092'], topic: 'ZPReportTransLogQC' },
      refundLog: { brokers: ['broker:9092'], topic: 'ZPReportTransLog' },
      paymentAuth: { brokers: ['broker:9092'], topic: 'payment_authentication_auth_session_status_qc' },
    },
  }),
}));

function minimalForm(overrides: Partial<FormState> = {}): FormState {
  return {
    actorName: '',
    taskName: 'CreateOrder',
    variables: [],
    protocol: 'grpc',
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    grpc: {
      protoContent: 'syntax = "proto3";',
      protoFilename: 'x.proto',
      serverAddress: 'localhost:1',
      service: 'Svc',
      method: 'Create',
      requestMessage: JSON.stringify({ appTransID: 'tx-1' }),
      metadata: [],
      secure: false,
      skipCertVerification: false,
    },
    extracts: [],
    questions: [],
    kafkaCheck: { enabled: false, topic: 'transLogV1' },
    afterResponse: [],
    ...overrides,
  };
}

describe('runCapture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the step, starts collecting before POSTing /runs, and returns the observed terminal status', async () => {
    const callOrder: string[] = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === 'http://localhost:3000/steps/CreateOrder') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(minimalForm()) });
      }
      if (url === 'http://localhost:3000/runs' && init?.method === 'POST') {
        callOrder.push('runs-posted');
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    mocks.collectKafkaMessages.mockImplementation(() => {
      callOrder.push('collect-started');
      return Promise.resolve({
        messages: [{ data: { appTransID: 'tx-1', status: 'SUCCESS' } }],
        receivedStatuses: ['SUCCESS'],
        terminatedBy: 'terminal-status',
        durationMs: 1234,
      });
    });

    const result = await runCapture({
      serverUrl: 'http://localhost:3000',
      kafkaConfigPath: '/fake/kafka.yaml',
      stepName: 'CreateOrder',
      topic: 'transLogV1',
      idleTimeoutMs: 15_000,
      terminalStatuses: ['SUCCESS', 'FAILED', 'PENDING'],
    });

    expect(callOrder).toEqual(['collect-started', 'runs-posted']);
    expect(mocks.collectKafkaMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        brokers: ['broker:9092'],
        topic: 'ZPReportTransLogQC',
        transId: 'tx-1',
        correlatorField: 'appTransID',
        hasDataWrapper: true,
        statusField: 'status',
        idleTimeoutMs: 15_000,
        terminalStatuses: ['SUCCESS', 'FAILED', 'PENDING'],
      })
    );
    expect(result).toEqual({
      status: 'SUCCESS',
      durationMs: 1234,
      messages: [{ data: { appTransID: 'tx-1', status: 'SUCCESS' } }],
    });

    vi.unstubAllGlobals();
  });

  it('throws when the capture times out without a terminal status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === 'http://localhost:3000/steps/CreateOrder') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(minimalForm()) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) });
      })
    );
    mocks.collectKafkaMessages.mockResolvedValue({
      messages: [],
      receivedStatuses: [],
      terminatedBy: 'idle-timeout',
      durationMs: 15_000,
    });

    await expect(
      runCapture({
        serverUrl: 'http://localhost:3000',
        kafkaConfigPath: '/fake/kafka.yaml',
        stepName: 'CreateOrder',
        topic: 'transLogV1',
        idleTimeoutMs: 15_000,
        terminalStatuses: ['SUCCESS', 'FAILED', 'PENDING'],
      })
    ).rejects.toThrow(/timed out/i);

    vi.unstubAllGlobals();
  });

  it('throws when the saved step cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));

    await expect(
      runCapture({
        serverUrl: 'http://localhost:3000',
        kafkaConfigPath: '/fake/kafka.yaml',
        stepName: 'Missing',
        topic: 'transLogV1',
        idleTimeoutMs: 15_000,
        terminalStatuses: ['SUCCESS'],
      })
    ).rejects.toThrow(/Missing/);

    vi.unstubAllGlobals();
  });

  it('throws when no correlator value can be extracted from the step', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(minimalForm({ grpc: { ...minimalForm().grpc, requestMessage: '{}' } })),
      })
    );

    await expect(
      runCapture({
        serverUrl: 'http://localhost:3000',
        kafkaConfigPath: '/fake/kafka.yaml',
        stepName: 'CreateOrder',
        topic: 'transLogV1',
        idleTimeoutMs: 15_000,
        terminalStatuses: ['SUCCESS'],
      })
    ).rejects.toThrow(/correlator/i);

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- baseline-capture-core.test.ts`
Expected: FAIL — `./baseline-capture-core.js` does not exist yet.

- [ ] **Step 3: Implement `runCapture`**

Create `packages/web/scripts/baseline-capture-core.ts`:

```ts
import { collectKafkaMessages } from '@ai-native-testing/server/src/kafka-message-collector.js';
import { loadKafkaConfig } from '@ai-native-testing/server/src/kafka-config.js';
import { KAFKA_TOPIC_DEFINITIONS, type KafkaTopicKey } from '@ai-native-testing/server/src/kafka-check-definitions.js';
import { buildTestDefinition } from '../src/dsl.js';
import { extractCorrelatorValue } from '../src/kafkaChecks.js';
import type { FormState } from '../src/types.js';

export interface RunCaptureOptions {
  serverUrl: string;
  kafkaConfigPath: string;
  stepName: string;
  topic: KafkaTopicKey;
  idleTimeoutMs: number;
  terminalStatuses: string[];
}

export interface RunCaptureResult {
  status: string;
  durationMs: number;
  messages: unknown[];
}

export async function runCapture(options: RunCaptureOptions): Promise<RunCaptureResult> {
  const stepResponse = await fetch(`${options.serverUrl}/steps/${encodeURIComponent(options.stepName)}`);
  if (!stepResponse.ok) {
    throw new Error(`Could not fetch saved step "${options.stepName}": HTTP ${stepResponse.status}`);
  }
  const form = (await stepResponse.json()) as FormState;

  const definition = buildTestDefinition(form);
  const transId = extractCorrelatorValue(form, options.topic);
  if (transId === undefined) {
    throw new Error(
      `Could not extract a correlator value for topic "${options.topic}" from step "${options.stepName}"`
    );
  }

  const kafkaConfig = loadKafkaConfig(options.kafkaConfigPath);
  if (!kafkaConfig) {
    throw new Error(`Could not load Kafka config from ${options.kafkaConfigPath}`);
  }
  const topicConfig = kafkaConfig.topics[options.topic];
  const topicDefinition = KAFKA_TOPIC_DEFINITIONS[options.topic];

  const collectorPromise = collectKafkaMessages({
    brokers: topicConfig.brokers,
    topic: topicConfig.topic,
    transId,
    correlatorField: topicDefinition.correlatorFields[0],
    statusField: 'status',
    hasDataWrapper: topicDefinition.hasDataWrapper,
    terminalStatuses: options.terminalStatuses,
    idleTimeoutMs: options.idleTimeoutMs,
  });

  const runResponse = await fetch(`${options.serverUrl}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(definition),
  });
  if (!runResponse.ok) {
    throw new Error(`Could not start the run for step "${options.stepName}": HTTP ${runResponse.status}`);
  }

  const result = await collectorPromise;
  if (result.terminatedBy !== 'terminal-status') {
    throw new Error(
      `Capture timed out after ${result.durationMs}ms waiting for a terminal status ` +
        `(received: ${result.receivedStatuses.join(', ') || 'none'}); no baseline was written.`
    );
  }

  return {
    status: result.receivedStatuses[result.receivedStatuses.length - 1],
    durationMs: result.durationMs,
    messages: result.messages,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- baseline-capture-core.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Full workspace verification**

Run, from the repo root:
```bash
pnpm test
pnpm typecheck
```
Expected: all packages green, zero typecheck errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/scripts/baseline-capture-core.ts packages/web/scripts/baseline-capture-core.test.ts
git commit -m "feat(web): add runCapture, the core Kafka baseline capture logic"
```

---

### Task 2: CLI scripts with overwrite protection

**Files:**
- Create: `packages/web/scripts/write-baseline.ts`
- Test: `packages/web/scripts/write-baseline.test.ts`
- Create: `packages/web/scripts/capture-baseline.ts`
- Create: `packages/web/scripts/update-baseline.ts`
- Modify: `packages/web/package.json`

**Interfaces:**
- Consumes: `runCapture`, `type RunCaptureOptions` (`./baseline-capture-core.js`, Task 1).
- Produces: `export async function writeBaseline(result: RunCaptureResult, options: { version: string; allowOverwrite: boolean; baselinesDir?: string }): Promise<string>` (returns the written file path; throws if the target file exists and `allowOverwrite` is `false`).

- [ ] **Step 1: Write the failing tests**

Create `packages/web/scripts/write-baseline.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeBaseline } from './write-baseline.js';
import type { RunCaptureResult } from './baseline-capture-core.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kafka-baselines-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function result(overrides: Partial<RunCaptureResult> = {}): RunCaptureResult {
  return { status: 'SUCCESS', durationMs: 1000, messages: [{ a: 1 }], ...overrides };
}

describe('writeBaseline', () => {
  it('writes a new baseline file at kafka-baselines/{version}/{status}.json', async () => {
    const path = await writeBaseline(result(), { version: 'v1', allowOverwrite: false, baselinesDir: dir });
    expect(path).toBe(join(dir, 'v1', 'SUCCESS.json'));
    const written = JSON.parse(await readFile(path, 'utf8'));
    expect(written.status).toBe('SUCCESS');
    expect(written.version).toBe('v1');
    expect(written.messages).toEqual([{ a: 1 }]);
    expect(typeof written.capturedAt).toBe('string');
  });

  it('refuses to overwrite an existing baseline when allowOverwrite is false', async () => {
    await writeBaseline(result(), { version: 'v1', allowOverwrite: false, baselinesDir: dir });
    await expect(
      writeBaseline(result(), { version: 'v1', allowOverwrite: false, baselinesDir: dir })
    ).rejects.toThrow(/already exists/i);
  });

  it('overwrites an existing baseline when allowOverwrite is true', async () => {
    await writeBaseline(result(), { version: 'v1', allowOverwrite: false, baselinesDir: dir });
    await writeBaseline(result({ durationMs: 2000 }), { version: 'v1', allowOverwrite: true, baselinesDir: dir });
    const path = join(dir, 'v1', 'SUCCESS.json');
    const written = JSON.parse(await readFile(path, 'utf8'));
    expect(written.durationMs).toBe(2000);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- write-baseline.test.ts`
Expected: FAIL — `./write-baseline.js` does not exist yet.

- [ ] **Step 3: Implement `writeBaseline` and the two CLI entry points**

Create `packages/web/scripts/write-baseline.ts`:

```ts
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunCaptureResult } from './baseline-capture-core.js';

const DEFAULT_BASELINES_DIR = join(process.cwd(), 'kafka-baselines');

export async function writeBaseline(
  result: RunCaptureResult,
  options: { version: string; allowOverwrite: boolean; baselinesDir?: string }
): Promise<string> {
  const baselinesDir = options.baselinesDir ?? DEFAULT_BASELINES_DIR;
  const versionDir = join(baselinesDir, options.version);
  const filePath = join(versionDir, `${result.status}.json`);

  if (!options.allowOverwrite) {
    const exists = await access(filePath).then(
      () => true,
      () => false
    );
    if (exists) {
      throw new Error(
        `Baseline already exists at ${filePath}. Use update-baseline.ts to intentionally overwrite it.`
      );
    }
  }

  await mkdir(versionDir, { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        version: options.version,
        status: result.status,
        durationMs: result.durationMs,
        messages: result.messages,
      },
      null,
      2
    )
  );
  return filePath;
}
```

Create `packages/web/scripts/capture-baseline.ts`:

```ts
import { parseArgs } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCapture } from './baseline-capture-core.js';
import { writeBaseline } from './write-baseline.js';
import type { KafkaTopicKey } from '@ai-native-testing/server/src/kafka-check-definitions.js';

const { values } = parseArgs({
  options: {
    step: { type: 'string' },
    version: { type: 'string' },
    topic: { type: 'string' },
    'server-url': { type: 'string', default: 'http://localhost:3000' },
    'kafka-config': { type: 'string' },
    'idle-timeout-ms': { type: 'string', default: '15000' },
  },
});

if (!values.step || !values.version || !values.topic) {
  console.error('Usage: capture-baseline.ts --step <name> --version <version> --topic <transLogV1|refundLog|paymentAuth>');
  process.exit(1);
}

const kafkaConfigPath =
  values['kafka-config'] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'config', 'kafka.yaml');

const result = await runCapture({
  serverUrl: values['server-url']!,
  kafkaConfigPath,
  stepName: values.step,
  topic: values.topic as KafkaTopicKey,
  idleTimeoutMs: Number(values['idle-timeout-ms']),
  terminalStatuses: ['SUCCESS', 'FAILED', 'PENDING'],
});

const path = await writeBaseline(result, { version: values.version, allowOverwrite: false });
console.log(`Baseline written to ${path}`);
```

Create `packages/web/scripts/update-baseline.ts` — identical to `capture-baseline.ts` except the final call passes `allowOverwrite: true`:

```ts
import { parseArgs } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCapture } from './baseline-capture-core.js';
import { writeBaseline } from './write-baseline.js';
import type { KafkaTopicKey } from '@ai-native-testing/server/src/kafka-check-definitions.js';

const { values } = parseArgs({
  options: {
    step: { type: 'string' },
    version: { type: 'string' },
    topic: { type: 'string' },
    'server-url': { type: 'string', default: 'http://localhost:3000' },
    'kafka-config': { type: 'string' },
    'idle-timeout-ms': { type: 'string', default: '15000' },
  },
});

if (!values.step || !values.version || !values.topic) {
  console.error('Usage: update-baseline.ts --step <name> --version <version> --topic <transLogV1|refundLog|paymentAuth>');
  process.exit(1);
}

const kafkaConfigPath =
  values['kafka-config'] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'config', 'kafka.yaml');

const result = await runCapture({
  serverUrl: values['server-url']!,
  kafkaConfigPath,
  stepName: values.step,
  topic: values.topic as KafkaTopicKey,
  idleTimeoutMs: Number(values['idle-timeout-ms']),
  terminalStatuses: ['SUCCESS', 'FAILED', 'PENDING'],
});

const path = await writeBaseline(result, { version: values.version, allowOverwrite: true });
console.log(`Baseline updated at ${path}`);
```

Add to `packages/web/package.json`'s `"scripts"`:
```json
"capture-baseline": "tsx scripts/capture-baseline.ts",
"update-baseline": "tsx scripts/update-baseline.ts"
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- write-baseline.test.ts`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Full workspace verification**

Run, from the repo root:
```bash
pnpm test
pnpm typecheck
```
Expected: all packages green, zero typecheck errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/scripts/write-baseline.ts packages/web/scripts/write-baseline.test.ts packages/web/scripts/capture-baseline.ts packages/web/scripts/update-baseline.ts packages/web/package.json
git commit -m "feat(web): add capture-baseline/update-baseline CLI scripts with overwrite protection"
```

- [ ] **Step 7: Note on manual/real-broker verification**

Same limitation as Step 1: no Docker/real broker in this environment. If you want to actually run `pnpm --filter @ai-native-testing/web capture-baseline -- --step "..." --version "..." --topic transLogV1` against your real broker later, add `kafka-baselines/` to review — the first real capture establishes the initial baseline for that version/status pair.
