# Kafka Contract Check Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Steps 1-3 of the Kafka contract-testing sub-project (collectKafkaMessages, versioned baselines, diffKafkaMessages) into a real GUI feature: a "Kafka Contract Check" triggerable from Simple Mode's Run button, tracked on its own "Kafka Contract Checks" page.

**Architecture:** A new, fully separate store/route/page pair mirrors the shape of the existing Kafka Check Tracking feature (register → poll), but the registration route itself fires a per-request ephemeral `collectKafkaMessages` call (rather than matching against an already-running shared consumer), then diffs the result against a stored baseline file. `buildApp()` (used by all tests) never touches a real broker — the route only fires real work when a `KafkaConfig` is explicitly passed in.

**Tech Stack:** TypeScript, Fastify, Vitest, React, `node:util`'s `parseArgs`, no new dependencies.

## Global Constraints

- New server files never import `@ai-native-testing/server`'s bare specifier from elsewhere in the workspace — irrelevant here since these files live inside `packages/server` itself and use plain relative imports.
- `terminalStatuses` for `runKafkaContractCheck` is `['SUCCESS', 'FAILED']` — narrower than Step 2's capture scripts (which also treat `PENDING` as terminal). `idleTimeoutMs` is `15000`, matching Step 2. **[Updated 2026-08-19]** `startFromMs` is `Date.now() - 24h` (a fixed lookback window), not "now" — added after real dogfooding showed a transaction that had already completed *before* registration could never be found otherwise, since the ephemeral collector only ever watches forward from `startFromMs`.
- Row `status` is one of `'pending' | 'passed' | 'failed' | 'error'`. `error` covers three causes — a `collectKafkaMessages` failure, an idle-timeout with no terminal status seen, and a missing/unreadable baseline file — each skipping the diff and storing a descriptive `errorMessage`.
- Baseline files live at `packages/server/data/kafka-baselines/{topic}/{version}/{status}.json` (already gitignored via `packages/server/data/`). **[Updated 2026-08-19]** The `{topic}` segment was added after real dogfooding showed two different topics sharing the same version string (e.g. `transLogV1` and `refundLog` both using `"1"`) would silently overwrite each other's baseline file — the original plan had no topic segment at all. The server reads via `join(DEFAULT_DATA_DIR, 'kafka-baselines')`; `packages/web`'s capture/update scripts gain a `--baselines-dir` flag defaulting to the same resolved path, and `writeBaseline` now requires a `topic` option.
- `POST /kafka-contract-checks` validates `message_id`/`name`/`topic`/`version` (400 if missing/invalid) and rejects with `503` (no row created) when no `KafkaConfig` is available — never creates a row that can never resolve.
- `buildApp()`'s test wiring always passes `kafkaConfig: undefined` unless a test explicitly supplies one; `index.ts` passes the real loaded config.
- Frontend: `KafkaContractCheckFormState { enabled: boolean; topic: KafkaTopic; version: string }`, added to `FormState` as `kafkaContractCheck`. Every old-saved-step load path must backfill a default via `normalizeFormState` (`packages/web/src/steps.ts`) — a previously-shipped bug (a blank white page on load) came from skipping this exact backfill for a new `FormState` field.
- `RunButton.tsx`'s new registration block checks `form.kafkaContractCheck.version.trim() !== ''` before registering, surfacing `"Kafka Contract Check: version is required."` via `onError` if blank.
- New route `/kafka-contract-checks` must be added to `packages/web/vite.config.ts`'s dev proxy — a new server route missing from that proxy has silently broken two prior increments.
- This feature is scoped to Simple Mode's `RunButton.tsx` only (the existing Kafka Check Tracking checkbox is likewise never wired into `FlowRunner`/`ApiAutomationPage`).

**[Post-launch operational note, added 2026-08-19]** A `collectKafkaMessages` failure to find a message looks identical whether the cause is auth/network or a wrong configured topic name — both present as a timeout with no matching message ever arriving. Real dogfooding on `refundLog` chased a TLS/SASL hypothesis (plausible, and TLS/SASL support was genuinely added to `KafkaTopicConfig`/the `Kafka` client as a result) before finding the actual cause: `kafka.yaml`'s `refundLog.topic` was `ZPReportTransLog`, but the real producer log showed the topic is actually `ZPReportTransLogDataQC`. Always cross-check a topic's configured name against real producer logs before assuming an auth or connectivity problem.

---

### Task 1: `KafkaContractCheckStore`

**Files:**
- Create: `packages/server/src/kafka-contract-check-store.ts`
- Test: `packages/server/test/kafka-contract-check-store.test.ts`

**Interfaces:**
- Consumes: `DiffReport` (type) from `./kafka-diff-engine.js`.
- Produces: `KafkaContractCheckStatus`, `KafkaContractCheckRow`, `KafkaContractCheckStore` (class with `list()`, `get(messageId)`, `create(row)`, `update(messageId, patch)`) — Tasks 2 and 3 both depend on these exact names.

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/kafka-contract-check-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KafkaContractCheckStore, type KafkaContractCheckRow } from '../src/kafka-contract-check-store.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kafka-contract-check-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function sampleRow(overrides: Partial<KafkaContractCheckRow> = {}): KafkaContractCheckRow {
  return {
    message_id: 'tx-1',
    name: 'Create Payment',
    topic: 'transLogV1',
    version: '1.0.0',
    status: 'pending',
    diffReport: null,
    errorMessage: null,
    created_at: '2026-08-13T00:00:00.000Z',
    updated_at: '2026-08-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('KafkaContractCheckStore', () => {
  it('returns an empty list and creates the file when it does not exist yet', async () => {
    const store = new KafkaContractCheckStore(join(dir, 'kafka-contract-checks.json'));
    expect(await store.list()).toEqual([]);
    const contents = await readFile(join(dir, 'kafka-contract-checks.json'), 'utf8');
    expect(JSON.parse(contents)).toEqual({});
  });

  it('creates and retrieves a row by message_id', async () => {
    const store = new KafkaContractCheckStore(join(dir, 'kafka-contract-checks.json'));
    await store.create(sampleRow());
    expect(await store.get('tx-1')).toEqual(sampleRow());
  });

  it('returns undefined for an unknown message_id', async () => {
    const store = new KafkaContractCheckStore(join(dir, 'kafka-contract-checks.json'));
    expect(await store.get('missing')).toBeUndefined();
  });

  it('lists rows newest-created first', async () => {
    const store = new KafkaContractCheckStore(join(dir, 'kafka-contract-checks.json'));
    await store.create(sampleRow({ message_id: 'tx-1', created_at: '2026-08-13T00:00:00.000Z' }));
    await store.create(sampleRow({ message_id: 'tx-2', created_at: '2026-08-13T00:00:05.000Z' }));
    const rows = await store.list();
    expect(rows.map((r) => r.message_id)).toEqual(['tx-2', 'tx-1']);
  });

  it('update merges a patch and bumps updated_at, returning the updated row', async () => {
    const store = new KafkaContractCheckStore(join(dir, 'kafka-contract-checks.json'));
    await store.create(sampleRow());
    const updated = await store.update('tx-1', { status: 'passed' });
    expect(updated?.status).toBe('passed');
    expect(updated?.updated_at).not.toBe('2026-08-13T00:00:00.000Z');
    expect(await store.get('tx-1')).toEqual(updated);
  });

  it('update returns undefined for an unknown message_id and does not create a row', async () => {
    const store = new KafkaContractCheckStore(join(dir, 'kafka-contract-checks.json'));
    expect(await store.update('missing', { status: 'error' })).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it('persists across separate store instances pointed at the same file', async () => {
    const filePath = join(dir, 'kafka-contract-checks.json');
    const first = new KafkaContractCheckStore(filePath);
    await first.create(sampleRow());

    const second = new KafkaContractCheckStore(filePath);
    expect(await second.get('tx-1')).toEqual(sampleRow());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test -- kafka-contract-check-store.test.ts`
Expected: FAIL — module `../src/kafka-contract-check-store.js` does not exist.

- [ ] **Step 3: Implement the store**

Create `packages/server/src/kafka-contract-check-store.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DiffReport } from './kafka-diff-engine.js';

export type KafkaContractCheckStatus = 'pending' | 'passed' | 'failed' | 'error';

export interface KafkaContractCheckRow {
  message_id: string;
  name: string;
  topic: string;
  version: string;
  status: KafkaContractCheckStatus;
  diffReport: DiffReport | null;
  errorMessage: string | null;
  created_at: string;
  updated_at: string;
}

export class KafkaContractCheckStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<KafkaContractCheckRow[]> {
    const map = await this.readMap();
    return Object.values(map).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  async get(messageId: string): Promise<KafkaContractCheckRow | undefined> {
    const map = await this.readMap();
    return map[messageId];
  }

  async create(row: KafkaContractCheckRow): Promise<void> {
    const map = await this.readMap();
    map[row.message_id] = row;
    await this.write(map);
  }

  async update(
    messageId: string,
    patch: Partial<KafkaContractCheckRow>
  ): Promise<KafkaContractCheckRow | undefined> {
    const map = await this.readMap();
    const existing = map[messageId];
    if (!existing) {
      return undefined;
    }
    const updated: KafkaContractCheckRow = { ...existing, ...patch, updated_at: new Date().toISOString() };
    map[messageId] = updated;
    await this.write(map);
    return updated;
  }

  private async readMap(): Promise<Record<string, KafkaContractCheckRow>> {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      return JSON.parse(contents) as Record<string, KafkaContractCheckRow>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.write({});
        return {};
      }
      throw err;
    }
  }

  private async write(map: Record<string, KafkaContractCheckRow>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(map, null, 2));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test -- kafka-contract-check-store.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/kafka-contract-check-store.ts packages/server/test/kafka-contract-check-store.test.ts
git commit -m "feat(server): add KafkaContractCheckStore"
```

---

### Task 2: `runKafkaContractCheck` state-machine runner

**Files:**
- Create: `packages/server/src/kafka-contract-check-runner.ts`
- Test: `packages/server/test/kafka-contract-check-runner.test.ts`

**Interfaces:**
- Consumes: `collectKafkaMessages` from `./kafka-message-collector.js`; `diffKafkaMessages` from `./kafka-diff-engine.js`; `KAFKA_TOPIC_DEFINITIONS`, `KafkaTopicKey` from `./kafka-check-definitions.js`; `KafkaConfig` (type) from `./kafka-config.js`; `KafkaContractCheckRow`, `KafkaContractCheckStore` from `./kafka-contract-check-store.js` (Task 1).
- Produces: `runKafkaContractCheck(row: KafkaContractCheckRow, kafkaConfig: KafkaConfig, baselinesDir: string, store: KafkaContractCheckStore): Promise<void>` — Task 3's route calls this exact signature.

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/kafka-contract-check-runner.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runKafkaContractCheck } from '../src/kafka-contract-check-runner.js';
import { KafkaContractCheckStore, type KafkaContractCheckRow } from '../src/kafka-contract-check-store.js';
import type { KafkaConfig } from '../src/kafka-config.js';

const mocks = vi.hoisted(() => {
  return { collectKafkaMessages: vi.fn() };
});

vi.mock('../src/kafka-message-collector.js', () => ({
  collectKafkaMessages: mocks.collectKafkaMessages,
}));

let dir: string;
let baselinesDir: string;
let store: KafkaContractCheckStore;

const KAFKA_CONFIG: KafkaConfig = {
  groupID: 'test-group',
  topics: {
    transLogV1: { brokers: ['broker:9092'], topic: 'ZPReportTransLogQC' },
    refundLog: { brokers: ['broker:9092'], topic: 'ZPReportTransLog' },
    paymentAuth: { brokers: ['broker:9092'], topic: 'payment_authentication_auth_session_status_qc' },
  },
};

function sampleRow(overrides: Partial<KafkaContractCheckRow> = {}): KafkaContractCheckRow {
  return {
    message_id: 'tx-1',
    name: 'Create Payment',
    topic: 'transLogV1',
    version: '1.0.0',
    status: 'pending',
    diffReport: null,
    errorMessage: null,
    created_at: '2026-08-13T00:00:00.000Z',
    updated_at: '2026-08-13T00:00:00.000Z',
    ...overrides,
  };
}

async function writeBaselineFixture(version: string, status: string, messages: unknown[]) {
  const versionDir = join(baselinesDir, version);
  await mkdir(versionDir, { recursive: true });
  await writeFile(join(versionDir, `${status}.json`), JSON.stringify({ messages }));
}

beforeEach(async () => {
  vi.clearAllMocks();
  dir = await mkdtemp(join(tmpdir(), 'kafka-contract-check-runner-'));
  baselinesDir = join(dir, 'kafka-baselines');
  store = new KafkaContractCheckStore(join(dir, 'kafka-contract-checks.json'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('runKafkaContractCheck', () => {
  it('resolves to passed when the diff has no critical findings', async () => {
    await store.create(sampleRow());
    await writeBaselineFixture('1.0.0', 'SUCCESS', [
      { data: { appTransID: 'tx-1', transID: 1, amount: 10000, status: 'SUCCESS' } },
    ]);
    mocks.collectKafkaMessages.mockResolvedValue({
      messages: [{ data: { appTransID: 'tx-1', transID: 2, amount: 10000, status: 'SUCCESS' } }],
      receivedStatuses: ['SUCCESS'],
      terminatedBy: 'terminal-status',
      durationMs: 500,
    });

    await runKafkaContractCheck(sampleRow(), KAFKA_CONFIG, baselinesDir, store);

    const row = await store.get('tx-1');
    expect(row?.status).toBe('passed');
    expect(row?.diffReport?.result).toBe('passed');
  });

  it('resolves to failed when the diff has a critical finding', async () => {
    await store.create(sampleRow());
    await writeBaselineFixture('1.0.0', 'SUCCESS', [
      { data: { appTransID: 'tx-1', transID: 1, amount: 10000, status: 'SUCCESS' } },
    ]);
    mocks.collectKafkaMessages.mockResolvedValue({
      messages: [{ data: { appTransID: 'tx-1', transID: 2, status: 'SUCCESS' } }],
      receivedStatuses: ['SUCCESS'],
      terminatedBy: 'terminal-status',
      durationMs: 500,
    });

    await runKafkaContractCheck(sampleRow(), KAFKA_CONFIG, baselinesDir, store);

    const row = await store.get('tx-1');
    expect(row?.status).toBe('failed');
    expect(row?.diffReport?.findings).toContainEqual(
      expect.objectContaining({ kind: 'missing-field', field: 'amount' })
    );
  });

  it('resolves to error with a descriptive message when collection fails', async () => {
    await store.create(sampleRow());
    mocks.collectKafkaMessages.mockRejectedValue(new Error('connection timeout'));

    await runKafkaContractCheck(sampleRow(), KAFKA_CONFIG, baselinesDir, store);

    const row = await store.get('tx-1');
    expect(row?.status).toBe('error');
    expect(row?.errorMessage).toContain('connection timeout');
  });

  it('resolves to error when the collector times out without a terminal status', async () => {
    await store.create(sampleRow());
    mocks.collectKafkaMessages.mockResolvedValue({
      messages: [],
      receivedStatuses: [],
      terminatedBy: 'idle-timeout',
      durationMs: 15_000,
    });

    await runKafkaContractCheck(sampleRow(), KAFKA_CONFIG, baselinesDir, store);

    const row = await store.get('tx-1');
    expect(row?.status).toBe('error');
    expect(row?.errorMessage).toMatch(/timed out/i);
  });

  it('resolves to error when no baseline file exists for the version/status', async () => {
    await store.create(sampleRow());
    mocks.collectKafkaMessages.mockResolvedValue({
      messages: [{ data: { appTransID: 'tx-1', status: 'SUCCESS' } }],
      receivedStatuses: ['SUCCESS'],
      terminatedBy: 'terminal-status',
      durationMs: 500,
    });

    await runKafkaContractCheck(sampleRow(), KAFKA_CONFIG, baselinesDir, store);

    const row = await store.get('tx-1');
    expect(row?.status).toBe('error');
    expect(row?.errorMessage).toContain('No baseline found');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test -- kafka-contract-check-runner.test.ts`
Expected: FAIL — module `../src/kafka-contract-check-runner.js` does not exist.

- [ ] **Step 3: Implement the runner**

Create `packages/server/src/kafka-contract-check-runner.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectKafkaMessages } from './kafka-message-collector.js';
import { diffKafkaMessages } from './kafka-diff-engine.js';
import { KAFKA_TOPIC_DEFINITIONS, type KafkaTopicKey } from './kafka-check-definitions.js';
import type { KafkaConfig } from './kafka-config.js';
import type { KafkaContractCheckRow, KafkaContractCheckStore } from './kafka-contract-check-store.js';

const IDLE_TIMEOUT_MS = 15_000;
const TERMINAL_STATUSES = ['SUCCESS', 'FAILED'];

interface BaselineFile {
  messages: unknown[];
}

export async function runKafkaContractCheck(
  row: KafkaContractCheckRow,
  kafkaConfig: KafkaConfig,
  baselinesDir: string,
  store: KafkaContractCheckStore
): Promise<void> {
  const topic = row.topic as KafkaTopicKey;
  const topicConfig = kafkaConfig.topics[topic];
  const topicDefinition = KAFKA_TOPIC_DEFINITIONS[topic];

  let result;
  try {
    result = await collectKafkaMessages({
      brokers: topicConfig.brokers,
      topic: topicConfig.topic,
      transId: row.message_id,
      correlatorField: topicDefinition.correlatorFields[0],
      statusField: 'status',
      hasDataWrapper: topicDefinition.hasDataWrapper,
      terminalStatuses: TERMINAL_STATUSES,
      idleTimeoutMs: IDLE_TIMEOUT_MS,
    });
  } catch (err) {
    await store.update(row.message_id, {
      status: 'error',
      errorMessage: `Kafka collection failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  if (result.terminatedBy !== 'terminal-status') {
    await store.update(row.message_id, {
      status: 'error',
      errorMessage: `Timed out after ${result.durationMs}ms waiting for a terminal status.`,
    });
    return;
  }

  const actualStatus = result.receivedStatuses[result.receivedStatuses.length - 1];
  const baselinePath = join(baselinesDir, row.version, `${actualStatus}.json`);
  let baselineFile: BaselineFile;
  try {
    const raw = await readFile(baselinePath, 'utf8');
    baselineFile = JSON.parse(raw) as BaselineFile;
  } catch {
    await store.update(row.message_id, {
      status: 'error',
      errorMessage: `No baseline found at ${row.version}/${actualStatus}.json`,
    });
    return;
  }

  const diffReport = diffKafkaMessages(baselineFile.messages, result.messages, topic);
  await store.update(row.message_id, { status: diffReport.result, diffReport });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test -- kafka-contract-check-runner.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/kafka-contract-check-runner.ts packages/server/test/kafka-contract-check-runner.test.ts
git commit -m "feat(server): add runKafkaContractCheck state-machine orchestrator"
```

---

### Task 3: Routes, app/index wiring, and baseline directory relocation

**Files:**
- Create: `packages/server/src/routes/kafka-contract-checks.ts`
- Test: `packages/server/test/kafka-contract-checks-routes.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/web/scripts/write-baseline.ts`
- Modify: `packages/web/scripts/capture-baseline.ts`
- Modify: `packages/web/scripts/update-baseline.ts`

**Interfaces:**
- Consumes: `KafkaContractCheckStore` (Task 1), `runKafkaContractCheck` (Task 2), `KAFKA_TOPIC_KEYS`/`KafkaTopicKey` from `../kafka-check-definitions.js`, `KafkaConfig` (type) from `../kafka-config.js`.
- Produces: `registerKafkaContractCheckRoutes(app, store, kafkaConfig, baselinesDir): void`, and `BuildAppOptions` gains `kafkaConfig?: KafkaConfig` — no later task depends on this, it completes the server side of the feature.

- [ ] **Step 1: Write the failing route tests**

Create `packages/server/test/kafka-contract-checks-routes.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import type { KafkaConfig } from '../src/kafka-config.js';

const mocks = vi.hoisted(() => {
  return { runKafkaContractCheck: vi.fn() };
});

vi.mock('../src/kafka-contract-check-runner.js', () => ({
  runKafkaContractCheck: mocks.runKafkaContractCheck,
}));

let dir: string | undefined;

afterEach(async () => {
  vi.clearAllMocks();
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

const KAFKA_CONFIG: KafkaConfig = {
  groupID: 'test-group',
  topics: {
    transLogV1: { brokers: ['broker:9092'], topic: 'ZPReportTransLogQC' },
    refundLog: { brokers: ['broker:9092'], topic: 'ZPReportTransLog' },
    paymentAuth: { brokers: ['broker:9092'], topic: 'payment_authentication_auth_session_status_qc' },
  },
};

async function buildTestApp(kafkaConfig?: KafkaConfig) {
  dir = await mkdtemp(join(tmpdir(), 'kafka-contract-checks-routes-'));
  return buildApp({ dataDir: dir, kafkaConfig });
}

describe('GET /kafka-contract-checks', () => {
  it('returns an empty list when nothing has been registered yet', async () => {
    const app = await buildTestApp(KAFKA_CONFIG);
    const res = await app.inject({ method: 'GET', url: '/kafka-contract-checks' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('POST /kafka-contract-checks', () => {
  it('creates a pending row, returns it with 201, and starts the runner when Kafka is configured', async () => {
    mocks.runKafkaContractCheck.mockResolvedValue(undefined);
    const app = await buildTestApp(KAFKA_CONFIG);
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-contract-checks',
      payload: { message_id: 'tx-1', name: 'Create Payment', topic: 'transLogV1', version: '1.0.0' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      message_id: 'tx-1',
      name: 'Create Payment',
      topic: 'transLogV1',
      version: '1.0.0',
      status: 'pending',
      diffReport: null,
      errorMessage: null,
    });
    expect(typeof body.created_at).toBe('string');
    expect(mocks.runKafkaContractCheck).toHaveBeenCalledWith(
      expect.objectContaining({ message_id: 'tx-1', version: '1.0.0' }),
      KAFKA_CONFIG,
      expect.stringContaining('kafka-baselines'),
      expect.anything()
    );
  });

  it('rejects with 503 and creates no row when Kafka is not configured', async () => {
    const app = await buildTestApp(undefined);
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-contract-checks',
      payload: { message_id: 'tx-1', name: 'Create Payment', topic: 'transLogV1', version: '1.0.0' },
    });
    expect(res.statusCode).toBe(503);
    expect(mocks.runKafkaContractCheck).not.toHaveBeenCalled();
    const list = await app.inject({ method: 'GET', url: '/kafka-contract-checks' });
    expect(list.json()).toEqual([]);
  });

  it('rejects a blank message_id with 400', async () => {
    const app = await buildTestApp(KAFKA_CONFIG);
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-contract-checks',
      payload: { message_id: '  ', name: 'x', topic: 'transLogV1', version: '1.0.0' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a blank name with 400', async () => {
    const app = await buildTestApp(KAFKA_CONFIG);
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-contract-checks',
      payload: { message_id: 'tx-1', name: '  ', topic: 'transLogV1', version: '1.0.0' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown topic with 400', async () => {
    const app = await buildTestApp(KAFKA_CONFIG);
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-contract-checks',
      payload: { message_id: 'tx-1', name: 'x', topic: 'disburseLog', version: '1.0.0' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a blank version with 400', async () => {
    const app = await buildTestApp(KAFKA_CONFIG);
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-contract-checks',
      payload: { message_id: 'tx-1', name: 'x', topic: 'transLogV1', version: '  ' },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test -- kafka-contract-checks-routes.test.ts`
Expected: FAIL — `buildApp` doesn't accept a `kafkaConfig` option yet, and `/kafka-contract-checks` doesn't exist (404s).

- [ ] **Step 3: Implement the route**

Create `packages/server/src/routes/kafka-contract-checks.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { KafkaContractCheckStore } from '../kafka-contract-check-store.js';
import { KAFKA_TOPIC_KEYS, type KafkaTopicKey } from '../kafka-check-definitions.js';
import type { KafkaConfig } from '../kafka-config.js';
import { runKafkaContractCheck } from '../kafka-contract-check-runner.js';

export function registerKafkaContractCheckRoutes(
  app: FastifyInstance,
  store: KafkaContractCheckStore,
  kafkaConfig: KafkaConfig | undefined,
  baselinesDir: string
): void {
  app.get('/kafka-contract-checks', async () => store.list());

  app.post('/kafka-contract-checks', async (request, reply) => {
    const { message_id, name, topic, version } = (request.body ?? {}) as {
      message_id?: string;
      name?: string;
      topic?: string;
      version?: string;
    };
    if (!message_id || message_id.trim() === '') {
      return reply.code(400).send({ error: 'message_id is required' });
    }
    if (!name || name.trim() === '') {
      return reply.code(400).send({ error: 'name is required' });
    }
    if (!topic || !KAFKA_TOPIC_KEYS.includes(topic as KafkaTopicKey)) {
      return reply.code(400).send({ error: `topic must be one of: ${KAFKA_TOPIC_KEYS.join(', ')}` });
    }
    if (!version || version.trim() === '') {
      return reply.code(400).send({ error: 'version is required' });
    }
    if (!kafkaConfig) {
      return reply.code(503).send({ error: 'Kafka is not configured on this server' });
    }

    const now = new Date().toISOString();
    const row = {
      message_id,
      name,
      topic,
      version,
      status: 'pending' as const,
      diffReport: null,
      errorMessage: null,
      created_at: now,
      updated_at: now,
    };
    await store.create(row);
    runKafkaContractCheck(row, kafkaConfig, baselinesDir, store).catch(() => {
      // runKafkaContractCheck already handles every failure path internally by
      // updating the row to 'error' — this catch only guards against it throwing
      // synchronously in a way that would otherwise become an unhandled rejection.
    });
    return reply.code(201).send(row);
  });
}
```

Modify `packages/server/src/app.ts` — add the import and `kafkaConfig` option, and wire the store/route right after the existing `registerKafkaCheckRoutes` call:

```ts
import type { KafkaConfig } from './kafka-config.js';
import { KafkaContractCheckStore } from './kafka-contract-check-store.js';
import { registerKafkaContractCheckRoutes } from './routes/kafka-contract-checks.js';
```

```ts
export interface BuildAppOptions {
  dataDir?: string;
  kafkaConfig?: KafkaConfig;
}
```

```ts
  const kafkaCheckStore = new KafkaCheckStore(join(dataDir, 'kafka-checks.json'));
  registerKafkaCheckRoutes(app, kafkaCheckStore);

  const kafkaContractCheckStore = new KafkaContractCheckStore(join(dataDir, 'kafka-contract-checks.json'));
  const baselinesDir = join(dataDir, 'kafka-baselines');
  registerKafkaContractCheckRoutes(app, kafkaContractCheckStore, options.kafkaConfig, baselinesDir);

  return app;
}
```

Modify `packages/server/src/index.ts` to load the Kafka config before building the app (so it can be passed in), replacing the whole file with:

```ts
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp, DEFAULT_DATA_DIR } from './app.js';
import { loadKafkaConfig } from './kafka-config.js';
import { KafkaCheckStore } from './kafka-check-store.js';
import { startKafkaConsumers } from './kafka-consumer.js';

const kafkaConfigPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'kafka.yaml');
const kafkaConfig = loadKafkaConfig(kafkaConfigPath);

const app = buildApp({ kafkaConfig });
const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: '0.0.0.0' }).then(() => {
  app.log.info(`server listening on port ${port}`);
});

if (kafkaConfig) {
  const kafkaCheckStore = new KafkaCheckStore(join(DEFAULT_DATA_DIR, 'kafka-checks.json'));
  startKafkaConsumers(kafkaConfig, kafkaCheckStore).catch((err) => {
    app.log.error(err, 'Failed to start Kafka consumers');
  });
} else {
  app.log.warn('Kafka check config not found at config/kafka.yaml — Check Kafka feature disabled');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test`
Expected: PASS — the full server suite green, including the 7 new route tests from this task plus the tests added in Tasks 1-2.

- [ ] **Step 5: Relocate the baseline directory default**

Modify `packages/web/scripts/write-baseline.ts` — change the default directory to live alongside the server's other data, replacing the top of the file:

```ts
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunCaptureResult } from './baseline-capture-core.js';

const DEFAULT_BASELINES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'server',
  'data',
  'kafka-baselines'
);
```

(The rest of `write-baseline.ts` — the `writeBaseline` function itself — is unchanged.)

Modify `packages/web/scripts/capture-baseline.ts` to add a `--baselines-dir` flag, changing the `parseArgs` call and the final `writeBaseline` call:

```ts
const { values } = parseArgs({
  options: {
    step: { type: 'string' },
    version: { type: 'string' },
    topic: { type: 'string' },
    'server-url': { type: 'string', default: 'http://localhost:3000' },
    'kafka-config': { type: 'string' },
    'idle-timeout-ms': { type: 'string', default: '15000' },
    'baselines-dir': { type: 'string' },
  },
});
```

```ts
const path = await writeBaseline(result, {
  version: values.version,
  allowOverwrite: false,
  baselinesDir: values['baselines-dir'],
});
console.log(`Baseline written to ${path}`);
```

Apply the identical change to `packages/web/scripts/update-baseline.ts` (same `parseArgs` addition; its final call keeps `allowOverwrite: true`):

```ts
const path = await writeBaseline(result, {
  version: values.version,
  allowOverwrite: true,
  baselinesDir: values['baselines-dir'],
});
console.log(`Baseline updated at ${path}`);
```

- [ ] **Step 6: Verify the new default path resolves correctly**

Run: `cd packages/web && node -e "console.log(require('path').join(__dirname, 'scripts', '..', '..', 'server', 'data', 'kafka-baselines'))"`
Expected: prints an absolute path ending in `packages/server/data/kafka-baselines` — confirms the relative traversal in `write-baseline.ts`'s new default is correct before trusting it.

- [ ] **Step 7: Run the full workspace test suite and typecheck**

Run: `pnpm test && pnpm typecheck` (from the repo root)
Expected: PASS — `write-baseline.test.ts` is unaffected (it always passes an explicit `baselinesDir` in its temp-directory tests), and no other test exercises the default constant directly.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/routes/kafka-contract-checks.ts packages/server/test/kafka-contract-checks-routes.test.ts packages/server/src/app.ts packages/server/src/index.ts packages/web/scripts/write-baseline.ts packages/web/scripts/capture-baseline.ts packages/web/scripts/update-baseline.ts
git commit -m "feat(server): add POST/GET /kafka-contract-checks and relocate baseline directory to packages/server/data"
```

---

### Task 4: Frontend `FormState` field, backfill, and fixture updates

**Files:**
- Modify: `packages/web/src/types.ts`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/steps.ts`
- Modify: `packages/web/test/steps.test.ts`
- Modify: `packages/web/test/dsl.test.ts`
- Modify: `packages/web/test/kafkaChecks.test.ts`
- Modify: `packages/web/test/components/FlowRunner.test.tsx`
- Modify: `packages/web/test/components/LoadStepSelect.test.tsx`
- Modify: `packages/web/test/components/SaveStepButton.test.tsx`
- Modify: `packages/web/test/components/ApiAutomationPage.test.tsx`
- Modify: `packages/web/test/components/RunButton.test.tsx`
- Modify: `packages/web/scripts/baseline-capture-core.test.ts`

**Interfaces:**
- Produces: `KafkaContractCheckFormState { enabled: boolean; topic: KafkaTopic; version: string }`, `FormState.kafkaContractCheck: KafkaContractCheckFormState` — every later frontend task depends on this exact shape and field name.

This task's own new behavior (the `normalizeFormState` backfill) is genuinely new logic under TDD. The remaining edits are mechanical: every file below builds a *complete* `FormState` literal, and TypeScript will not compile once `FormState` requires `kafkaContractCheck` until each is updated — `pnpm typecheck` after Step 3 below is your checklist.

- [ ] **Step 1: Write the failing backfill test**

Modify `packages/web/test/steps.test.ts`'s existing backfill test (the one starting `it('backfills kafkaCheck and afterResponse...')`), replacing it with:

```ts
  it('backfills kafkaCheck, kafkaContractCheck, and afterResponse when a saved step predates those fields', async () => {
    const { kafkaCheck, kafkaContractCheck, afterResponse, ...legacyForm } = sampleForm();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(legacyForm) })
    );

    const result = await fetchStep('Create Payment');

    expect(result?.kafkaCheck).toEqual({ enabled: false, topic: 'transLogV1' });
    expect(result?.kafkaContractCheck).toEqual({ enabled: false, topic: 'transLogV1', version: '' });
    expect(result?.afterResponse).toEqual([]);
  });
```

Also update `sampleForm()` in the same file (`packages/web/test/steps.test.ts`), changing:

```ts
    kafkaCheck: { enabled: false, topic: 'transLogV1' },
    afterResponse: [],
```

to:

```ts
    kafkaCheck: { enabled: false, topic: 'transLogV1' },
    kafkaContractCheck: { enabled: false, topic: 'transLogV1', version: '' },
    afterResponse: [],
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ai-native-testing/web test -- steps.test.ts`
Expected: FAIL — `FormState` doesn't have `kafkaContractCheck` yet (a TypeScript error surfaces here since `sampleForm()`'s return type is `FormState`; treat this the same as a failing test).

- [ ] **Step 3: Add the field to `FormState` and its two default sites**

Modify `packages/web/src/types.ts`, adding a new interface right after `KafkaCheckFormState` and a new field on `FormState`:

```ts
export interface KafkaCheckFormState {
  enabled: boolean;
  topic: KafkaTopic;
}

export interface KafkaContractCheckFormState {
  enabled: boolean;
  topic: KafkaTopic;
  version: string;
}
```

```ts
  kafkaCheck: KafkaCheckFormState;
  kafkaContractCheck: KafkaContractCheckFormState;
  afterResponse: KeyValueRow[];
```

Modify `packages/web/src/App.tsx`'s `initialForm()`, changing:

```ts
    kafkaCheck: { enabled: false, topic: 'transLogV1' },
    afterResponse: [],
```

to:

```ts
    kafkaCheck: { enabled: false, topic: 'transLogV1' },
    kafkaContractCheck: { enabled: false, topic: 'transLogV1', version: '' },
    afterResponse: [],
```

Modify `packages/web/src/steps.ts`'s `normalizeFormState`, changing:

```ts
function normalizeFormState(form: FormState): FormState {
  return {
    ...form,
    kafkaCheck: form.kafkaCheck ?? { enabled: false, topic: 'transLogV1' },
    afterResponse: form.afterResponse ?? [],
  };
}
```

to:

```ts
function normalizeFormState(form: FormState): FormState {
  return {
    ...form,
    kafkaCheck: form.kafkaCheck ?? { enabled: false, topic: 'transLogV1' },
    kafkaContractCheck: form.kafkaContractCheck ?? { enabled: false, topic: 'transLogV1', version: '' },
    afterResponse: form.afterResponse ?? [],
  };
}
```

- [ ] **Step 4: Fix every other fixture the compiler flags**

Run: `pnpm --filter @ai-native-testing/web typecheck`

This lists every remaining file whose `FormState` literal is now missing the required field. Apply the identical one-line addition (`kafkaContractCheck: { enabled: false, topic: 'transLogV1', version: '' },` immediately after the existing `kafkaCheck: { enabled: false, topic: 'transLogV1' },` line) to each of the following — all six use the exact same two-line `kafkaCheck`/`afterResponse` pair, so replace:

```ts
    kafkaCheck: { enabled: false, topic: 'transLogV1' },
    afterResponse: [],
```

with:

```ts
    kafkaCheck: { enabled: false, topic: 'transLogV1' },
    kafkaContractCheck: { enabled: false, topic: 'transLogV1', version: '' },
    afterResponse: [],
```

in each of:
- `packages/web/test/dsl.test.ts` (inside `emptyForm`)
- `packages/web/test/kafkaChecks.test.ts` (inside `sampleForm`)
- `packages/web/test/components/FlowRunner.test.tsx` (inside `sampleForm`)
- `packages/web/test/components/LoadStepSelect.test.tsx` (inside `sampleForm`)
- `packages/web/test/components/SaveStepButton.test.tsx` (inside `sampleForm`)
- `packages/web/scripts/baseline-capture-core.test.ts` (inside `minimalForm`)

For `packages/web/test/components/ApiAutomationPage.test.tsx`, the identical two-line pair appears **twice** (inside both `makeGrpcForm` and `makeRestForm`) — apply the same replacement to both occurrences.

For `packages/web/test/components/RunButton.test.tsx`, only the base `emptyForm()` function needs the addition (its other two `kafkaCheck: { enabled: true, topic: 'transLogV1' as const }` occurrences are partial overrides spread on top of `emptyForm()`, which will already carry the new field once `emptyForm()` itself is fixed — do not touch those two lines). Apply the same two-line replacement to `emptyForm()`'s body only.

- [ ] **Step 5: Run typecheck again to confirm zero errors**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: PASS, no errors.

- [ ] **Step 6: Run the full web test suite**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS — all existing tests green, including the updated backfill test from Step 1.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/types.ts packages/web/src/App.tsx packages/web/src/steps.ts packages/web/test/steps.test.ts packages/web/test/dsl.test.ts packages/web/test/kafkaChecks.test.ts packages/web/test/components/FlowRunner.test.tsx packages/web/test/components/LoadStepSelect.test.tsx packages/web/test/components/SaveStepButton.test.tsx packages/web/test/components/ApiAutomationPage.test.tsx packages/web/test/components/RunButton.test.tsx packages/web/scripts/baseline-capture-core.test.ts
git commit -m "feat(web): add kafkaContractCheck to FormState, backfilling old saved steps"
```

---

### Task 5: `kafkaContractChecks.ts` client + `RequestBuilder.tsx` UI section

**Files:**
- Create: `packages/web/src/kafkaContractChecks.ts`
- Test: `packages/web/test/kafkaContractChecks.test.ts`
- Modify: `packages/web/src/components/RequestBuilder.tsx`
- Modify: `packages/web/src/components/SimpleModePage.tsx`
- Modify: `packages/web/test/components/RequestBuilder.test.tsx`

**Interfaces:**
- Consumes: `KafkaContractCheckFormState`, `KafkaTopic`, `KAFKA_TOPICS` from `../types` (Task 4).
- Produces: `registerKafkaContractCheck({ message_id, name, topic, version }): Promise<void>`, `fetchKafkaContractChecks(): Promise<KafkaContractCheckRow[]>`, `KafkaContractCheckRow` (type) from `packages/web/src/kafkaContractChecks.ts` — Tasks 6 and 7 both import from this file. `RequestBuilder`'s new props `kafkaContractCheck`/`onKafkaContractCheckChange` — no later task depends on these directly, but they complete the Simple Mode UI surface.

- [ ] **Step 1: Write the failing client tests**

Create `packages/web/test/kafkaContractChecks.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerKafkaContractCheck, fetchKafkaContractChecks } from '../src/kafkaContractChecks';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('registerKafkaContractCheck', () => {
  it('POSTs the message_id, name, topic, and version', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);

    await registerKafkaContractCheck({
      message_id: 'tx-1',
      name: 'Create Payment',
      topic: 'transLogV1',
      version: '1.0.0',
    });

    expect(fetchMock).toHaveBeenCalledWith('/kafka-contract-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: 'tx-1', name: 'Create Payment', topic: 'transLogV1', version: '1.0.0' }),
    });
  });

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    await expect(
      registerKafkaContractCheck({ message_id: 'tx-1', name: 'x', topic: 'transLogV1', version: '1.0.0' })
    ).rejects.toThrow();
  });
});

describe('fetchKafkaContractChecks', () => {
  it('returns the parsed list on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([{ message_id: 'tx-1' }]) })
    );
    expect(await fetchKafkaContractChecks()).toEqual([{ message_id: 'tx-1' }]);
  });

  it('returns an empty array when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve([]) }));
    expect(await fetchKafkaContractChecks()).toEqual([]);
  });

  it('returns an empty array when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchKafkaContractChecks()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- kafkaContractChecks.test.ts`
Expected: FAIL — module `../src/kafkaContractChecks` does not exist.

- [ ] **Step 3: Implement the client module**

Create `packages/web/src/kafkaContractChecks.ts`:

```ts
import type { KafkaTopic } from './types';
import type { DiffReport } from '@ai-native-testing/server/src/kafka-diff-engine.js';

export interface KafkaContractCheckRow {
  message_id: string;
  name: string;
  topic: string;
  version: string;
  status: 'pending' | 'passed' | 'failed' | 'error';
  diffReport: DiffReport | null;
  errorMessage: string | null;
  created_at: string;
  updated_at: string;
}

export async function registerKafkaContractCheck(params: {
  message_id: string;
  name: string;
  topic: KafkaTopic;
  version: string;
}): Promise<void> {
  const response = await fetch('/kafka-contract-checks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    throw new Error('Could not register the Kafka contract check.');
  }
}

export async function fetchKafkaContractChecks(): Promise<KafkaContractCheckRow[]> {
  try {
    const response = await fetch('/kafka-contract-checks');
    if (!response.ok) {
      return [];
    }
    return (await response.json()) as KafkaContractCheckRow[];
  } catch {
    return [];
  }
}
```

`DiffReport` is a type-only import — it's fully erased at compile time, so this never bundles or executes any of `@ai-native-testing/server`'s code in the browser build, and never risks the server bootstrap side effect that makes bare/value imports of that package dangerous.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- kafkaContractChecks.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing `RequestBuilder` UI tests**

Modify `packages/web/test/components/RequestBuilder.test.tsx`'s `baseProps()`, changing:

```ts
    kafkaCheck: { enabled: false, topic: 'transLogV1' },
    onKafkaCheckChange: vi.fn(),
```

to:

```ts
    kafkaCheck: { enabled: false, topic: 'transLogV1' },
    onKafkaCheckChange: vi.fn(),
    kafkaContractCheck: { enabled: false, topic: 'transLogV1', version: '' },
    onKafkaContractCheckChange: vi.fn(),
```

Then add these four tests immediately after the existing `it('calls onKafkaCheckChange when the Kafka Topic select changes', ...)` test (the block ending around the existing `});` before the `'renders the Before invoke tab...'` test):

```ts
  it('renders Kafka Contract Check unchecked by default, with no Contract Check fields', () => {
    render(<RequestBuilder {...baseProps()} />);
    expect(screen.getByLabelText('Kafka Contract Check')).not.toBeChecked();
    expect(screen.queryByLabelText('Contract Check Topic')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Contract Check Version')).not.toBeInTheDocument();
  });

  it('shows the Contract Check fields, defaulted correctly, when Kafka Contract Check is checked', () => {
    render(
      <RequestBuilder
        {...baseProps({ kafkaContractCheck: { enabled: true, topic: 'refundLog', version: '1.2.0' } })}
      />
    );
    expect(screen.getByLabelText('Contract Check Topic')).toHaveValue('refundLog');
    expect(screen.getByLabelText('Contract Check Version')).toHaveValue('1.2.0');
  });

  it('calls onKafkaContractCheckChange when the Kafka Contract Check checkbox is toggled', async () => {
    const onKafkaContractCheckChange = vi.fn();
    render(<RequestBuilder {...baseProps({ onKafkaContractCheckChange })} />);
    await userEvent.click(screen.getByLabelText('Kafka Contract Check'));
    expect(onKafkaContractCheckChange).toHaveBeenCalledWith({ enabled: true, topic: 'transLogV1', version: '' });
  });

  it('calls onKafkaContractCheckChange when the Contract Check Topic select changes', async () => {
    const onKafkaContractCheckChange = vi.fn();
    render(
      <RequestBuilder
        {...baseProps({
          kafkaContractCheck: { enabled: true, topic: 'transLogV1', version: '' },
          onKafkaContractCheckChange,
        })}
      />
    );
    await userEvent.selectOptions(screen.getByLabelText('Contract Check Topic'), 'paymentAuth');
    expect(onKafkaContractCheckChange).toHaveBeenCalledWith({ enabled: true, topic: 'paymentAuth', version: '' });
  });

  it('calls onKafkaContractCheckChange when the Contract Check Version input changes', async () => {
    const onKafkaContractCheckChange = vi.fn();
    render(
      <RequestBuilder
        {...baseProps({
          kafkaContractCheck: { enabled: true, topic: 'transLogV1', version: '' },
          onKafkaContractCheckChange,
        })}
      />
    );
    await userEvent.type(screen.getByLabelText('Contract Check Version'), '2');
    expect(onKafkaContractCheckChange).toHaveBeenCalledWith({ enabled: true, topic: 'transLogV1', version: '2' });
  });
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- RequestBuilder.test.tsx`
Expected: FAIL — `RequestBuilder` doesn't accept `kafkaContractCheck`/`onKafkaContractCheckChange` props yet, and the labels don't exist.

- [ ] **Step 7: Implement the `RequestBuilder.tsx` section**

Modify the import block at the top of `packages/web/src/components/RequestBuilder.tsx`, changing:

```ts
import {
  KAFKA_TOPICS,
  type AuthConfig,
  type ExtractRow,
  type GrpcFormState,
  type KafkaCheckFormState,
  type KeyValueRow,
  type Protocol,
  type QuestionRow,
} from '../types';
```

to:

```ts
import {
  KAFKA_TOPICS,
  type AuthConfig,
  type ExtractRow,
  type GrpcFormState,
  type KafkaCheckFormState,
  type KafkaContractCheckFormState,
  type KeyValueRow,
  type Protocol,
  type QuestionRow,
} from '../types';
```

Add to `RequestBuilderProps`, right after the existing `onKafkaCheckChange` line:

```ts
  kafkaCheck: KafkaCheckFormState;
  onKafkaCheckChange: (kafkaCheck: KafkaCheckFormState) => void;
  kafkaContractCheck: KafkaContractCheckFormState;
  onKafkaContractCheckChange: (kafkaContractCheck: KafkaContractCheckFormState) => void;
```

Add to the destructure inside `RequestBuilder`, right after the existing `onKafkaCheckChange,` line:

```ts
    kafkaCheck,
    onKafkaCheckChange,
    kafkaContractCheck,
    onKafkaContractCheckChange,
```

Add a new section right after the existing "Check Kafka" `</div>` block (immediately before `{protocol === 'rest' ? (`):

```tsx
      <div className="row">
        <label className="label">
          Kafka Contract Check
          <input
            type="checkbox"
            checked={kafkaContractCheck.enabled}
            onChange={(e) => onKafkaContractCheckChange({ ...kafkaContractCheck, enabled: e.target.checked })}
          />
        </label>
        {kafkaContractCheck.enabled && (
          <>
            <label className="label">
              Contract Check Topic
              <select
                className="text-input"
                value={kafkaContractCheck.topic}
                onChange={(e) =>
                  onKafkaContractCheckChange({
                    ...kafkaContractCheck,
                    topic: e.target.value as KafkaContractCheckFormState['topic'],
                  })
                }
              >
                {KAFKA_TOPICS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Contract Check Version
              <input
                className="text-input"
                value={kafkaContractCheck.version}
                onChange={(e) => onKafkaContractCheckChange({ ...kafkaContractCheck, version: e.target.value })}
              />
            </label>
          </>
        )}
      </div>
```

- [ ] **Step 8: Wire the new props through `SimpleModePage.tsx`**

Modify `packages/web/src/components/SimpleModePage.tsx`, changing:

```tsx
        kafkaCheck={form.kafkaCheck}
        onKafkaCheckChange={(kafkaCheck) => onFormChange((prev) => ({ ...prev, kafkaCheck }))}
      />
```

to:

```tsx
        kafkaCheck={form.kafkaCheck}
        onKafkaCheckChange={(kafkaCheck) => onFormChange((prev) => ({ ...prev, kafkaCheck }))}
        kafkaContractCheck={form.kafkaContractCheck}
        onKafkaContractCheckChange={(kafkaContractCheck) => onFormChange((prev) => ({ ...prev, kafkaContractCheck }))}
      />
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- RequestBuilder.test.tsx`
Expected: PASS.

- [ ] **Step 10: Run the full web test suite and typecheck**

Run: `pnpm --filter @ai-native-testing/web test && pnpm --filter @ai-native-testing/web typecheck`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/web/src/kafkaContractChecks.ts packages/web/test/kafkaContractChecks.test.ts packages/web/src/components/RequestBuilder.tsx packages/web/src/components/SimpleModePage.tsx packages/web/test/components/RequestBuilder.test.tsx
git commit -m "feat(web): add Kafka Contract Check section to the Request Builder"
```

---

### Task 6: `RunButton.tsx` registration wiring

**Files:**
- Modify: `packages/web/src/components/RunButton.tsx`
- Modify: `packages/web/test/components/RunButton.test.tsx`

**Interfaces:**
- Consumes: `registerKafkaContractCheck` from `../kafkaContractChecks` (Task 5); `correlatorFieldFor`, `extractCorrelatorValue` from `../kafkaChecks` (already used by the existing Kafka Check block).
- Produces: nothing new consumed by later tasks — this completes the trigger side of the feature.

- [ ] **Step 1: Write the failing tests**

Add these four tests to `packages/web/test/components/RunButton.test.tsx`, immediately after the existing `it('does not register a Kafka check when Check Kafka is disabled', ...)` test (before the closing `});` of the outer `describe('RunButton', ...)` block):

```ts
  it('registers a Kafka contract check alongside the run when enabled', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/kafka-contract-checks') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const form = {
      ...emptyForm(),
      body: '{"appTransID":"tx-123"}',
      kafkaContractCheck: { enabled: true, topic: 'transLogV1' as const, version: '1.0.0' },
    };
    render(<RunButton form={form} disabled={false} onRunStart={() => {}} onEvent={() => {}} onError={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(fetchMock).toHaveBeenCalledWith('/kafka-contract-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: 'tx-123', name: 'Task', topic: 'transLogV1', version: '1.0.0' }),
    });
  });

  it('calls onError and skips registration when the version field is blank', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) }));
    const onError = vi.fn();
    const form = {
      ...emptyForm(),
      body: '{"appTransID":"tx-123"}',
      kafkaContractCheck: { enabled: true, topic: 'transLogV1' as const, version: '' },
    };
    render(<RunButton form={form} disabled={false} onRunStart={() => {}} onEvent={() => {}} onError={onError} />);

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(onError).toHaveBeenCalledWith('Kafka Contract Check: version is required.');
  });

  it('calls onError and skips registration when the correlator field is missing from the body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) }));
    const onError = vi.fn();
    const form = {
      ...emptyForm(),
      body: '{"other":1}',
      kafkaContractCheck: { enabled: true, topic: 'transLogV1' as const, version: '1.0.0' },
    };
    render(<RunButton form={form} disabled={false} onRunStart={() => {}} onEvent={() => {}} onError={onError} />);

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('appTransID'));
  });

  it('does not register a Kafka contract check when disabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <RunButton form={emptyForm()} disabled={false} onRunStart={() => {}} onEvent={() => {}} onError={() => {}} />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(fetchMock).not.toHaveBeenCalledWith('/kafka-contract-checks', expect.anything());
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- RunButton.test.tsx`
Expected: FAIL — `RunButton` doesn't register a contract check yet.

- [ ] **Step 3: Implement the registration logic**

Modify `packages/web/src/components/RunButton.tsx`'s import line, changing:

```ts
import { correlatorFieldFor, extractCorrelatorValue, registerKafkaCheck } from '../kafkaChecks';
```

to:

```ts
import { correlatorFieldFor, extractCorrelatorValue, registerKafkaCheck } from '../kafkaChecks';
import { registerKafkaContractCheck } from '../kafkaContractChecks';
```

Add a new block right after the existing `if (form.kafkaCheck.enabled) { ... }` block, before `let definition;`:

```ts
    if (form.kafkaContractCheck.enabled) {
      if (form.kafkaContractCheck.version.trim() === '') {
        onError('Kafka Contract Check: version is required.');
      } else {
        const correlatorValue = extractCorrelatorValue(form, form.kafkaContractCheck.topic);
        if (correlatorValue === undefined) {
          onError(
            `Kafka Contract Check: could not find "${correlatorFieldFor(form.kafkaContractCheck.topic)}" in the request body.`
          );
        } else {
          registerKafkaContractCheck({
            message_id: correlatorValue,
            name: form.taskName,
            topic: form.kafkaContractCheck.topic,
            version: form.kafkaContractCheck.version,
          }).catch(() => {
            onError('Kafka Contract Check: could not register the check.');
          });
        }
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- RunButton.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/RunButton.tsx packages/web/test/components/RunButton.test.tsx
git commit -m "feat(web): register a Kafka contract check from RunButton when enabled"
```

---

### Task 7: `KafkaContractChecksPage.tsx`

**Files:**
- Create: `packages/web/src/components/KafkaContractChecksPage.tsx`
- Test: `packages/web/test/components/KafkaContractChecksPage.test.tsx`

**Interfaces:**
- Consumes: `fetchKafkaContractChecks`, `registerKafkaContractCheck`, `KafkaContractCheckRow` from `../kafkaContractChecks` (Task 5); `KAFKA_TOPICS`, `KafkaTopic` from `../types`.
- Produces: `KafkaContractChecksPage` component — Task 8 imports and routes to it.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/test/components/KafkaContractChecksPage.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KafkaContractChecksPage } from '../../src/components/KafkaContractChecksPage';
import type { KafkaContractCheckRow } from '../../src/kafkaContractChecks';

function makeRow(overrides: Partial<KafkaContractCheckRow> = {}): KafkaContractCheckRow {
  return {
    message_id: 'tx-1',
    name: 'Create Payment',
    topic: 'transLogV1',
    version: '1.0.0',
    status: 'passed',
    diffReport: { result: 'passed', findings: [] },
    errorMessage: null,
    created_at: '2026-08-13T00:00:00.000Z',
    updated_at: '2026-08-13T00:00:01.000Z',
    ...overrides,
  };
}

describe('KafkaContractChecksPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists fetched rows with name, topic/version, and status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([makeRow()]) }));
    render(<KafkaContractChecksPage />);
    const row = await screen.findByRole('button', { name: /Create Payment/ });
    expect(row).toHaveTextContent('transLogV1');
    expect(row).toHaveTextContent('1.0.0');
    expect(row).toHaveTextContent('passed');
  });

  it('expands a row to show its diff findings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            makeRow({
              status: 'failed',
              diffReport: {
                result: 'failed',
                findings: [
                  { kind: 'missing-field', status: 'SUCCESS', field: 'amount', severity: 'critical', baselineValue: 10000 },
                ],
              },
            }),
          ]),
      })
    );
    render(<KafkaContractChecksPage />);
    const row = await screen.findByRole('button', { name: /Create Payment/ });
    await userEvent.click(row);
    expect(await screen.findByText(/CRITICAL.*missing-field.*field=amount/)).toBeInTheDocument();
  });

  it('shows the error message instead of findings when the check errored', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            makeRow({ status: 'error', diffReport: null, errorMessage: 'No baseline found at 1.0.0/SUCCESS.json' }),
          ]),
      })
    );
    render(<KafkaContractChecksPage />);
    const row = await screen.findByRole('button', { name: /Create Payment/ });
    await userEvent.click(row);
    expect(await screen.findByText('No baseline found at 1.0.0/SUCCESS.json')).toBeInTheDocument();
  });

  it('shows an empty state when there are no checks yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    render(<KafkaContractChecksPage />);
    expect(await screen.findByText('No Kafka contract checks yet.')).toBeInTheDocument();
  });
});

describe('KafkaContractChecksPage — manual check form', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the transid textbox, Kafka Topic select, Version input, and Check Contract button', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    render(<KafkaContractChecksPage />);
    expect(screen.getByLabelText('Transaction ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Kafka Topic')).toBeInTheDocument();
    expect(screen.getByLabelText('Version')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check Contract' })).toBeInTheDocument();
  });

  it('disables Check Contract until transid, topic, and version are all filled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    render(<KafkaContractChecksPage />);
    expect(screen.getByRole('button', { name: 'Check Contract' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    expect(screen.getByRole('button', { name: 'Check Contract' })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'transLogV1');
    expect(screen.getByRole('button', { name: 'Check Contract' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Version'), '1.0.0');
    expect(screen.getByRole('button', { name: 'Check Contract' })).toBeEnabled();
  });

  it('registers a check using the transid as both message_id and name', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/kafka-contract-checks' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<KafkaContractChecksPage />);
    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'paymentAuth');
    await userEvent.type(screen.getByLabelText('Version'), '1.0.0');
    await userEvent.click(screen.getByRole('button', { name: 'Check Contract' }));

    expect(fetchMock).toHaveBeenCalledWith('/kafka-contract-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: 'tx-123', name: 'tx-123', topic: 'paymentAuth', version: '1.0.0' }),
    });
  });

  it('shows an inline error when registration fails', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/kafka-contract-checks' && init?.method === 'POST') {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<KafkaContractChecksPage />);
    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'paymentAuth');
    await userEvent.type(screen.getByLabelText('Version'), '1.0.0');
    await userEvent.click(screen.getByRole('button', { name: 'Check Contract' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not register the Kafka contract check. Please try again.'
    );
  });
});

describe('KafkaContractChecksPage — inline result panel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows a pending panel immediately after registering, before the tracked row appears in the polled list', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/kafka-contract-checks' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<KafkaContractChecksPage />);
    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'paymentAuth');
    await userEvent.type(screen.getByLabelText('Version'), '1.0.0');
    await userEvent.click(screen.getByRole('button', { name: 'Check Contract' }));

    expect(await screen.findByText('Pending…')).toBeInTheDocument();
  });

  it('shows PASSED once the tracked row resolves as passed in the polled list', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/kafka-contract-checks' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([makeRow({ message_id: 'tx-123', status: 'passed' })]),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<KafkaContractChecksPage />);
    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'paymentAuth');
    await userEvent.type(screen.getByLabelText('Version'), '1.0.0');
    await userEvent.click(screen.getByRole('button', { name: 'Check Contract' }));

    expect(await screen.findByText('PASSED')).toBeInTheDocument();
  });

  it('shows FAILED once the tracked row resolves as failed', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/kafka-contract-checks' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            makeRow({
              message_id: 'tx-123',
              status: 'failed',
              diffReport: {
                result: 'failed',
                findings: [
                  { kind: 'missing-field', status: 'SUCCESS', field: 'amount', severity: 'critical', baselineValue: 10000 },
                ],
              },
            }),
          ]),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<KafkaContractChecksPage />);
    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'paymentAuth');
    await userEvent.type(screen.getByLabelText('Version'), '1.0.0');
    await userEvent.click(screen.getByRole('button', { name: 'Check Contract' }));

    expect(await screen.findByText('FAILED')).toBeInTheDocument();
  });

  it('shows ERROR with the error message once the tracked row resolves as error', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/kafka-contract-checks' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            makeRow({
              message_id: 'tx-123',
              status: 'error',
              diffReport: null,
              errorMessage: 'No baseline found at 1.0.0/SUCCESS.json',
            }),
          ]),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<KafkaContractChecksPage />);
    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'paymentAuth');
    await userEvent.type(screen.getByLabelText('Version'), '1.0.0');
    await userEvent.click(screen.getByRole('button', { name: 'Check Contract' }));

    expect(await screen.findByText('ERROR')).toBeInTheDocument();
    expect(await screen.findByText('No baseline found at 1.0.0/SUCCESS.json')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- KafkaContractChecksPage.test.tsx`
Expected: FAIL — module `../../src/components/KafkaContractChecksPage` does not exist.

- [ ] **Step 3: Implement the page**

Create `packages/web/src/components/KafkaContractChecksPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import {
  fetchKafkaContractChecks,
  registerKafkaContractCheck,
  type KafkaContractCheckRow,
} from '../kafkaContractChecks';
import { KAFKA_TOPICS, type KafkaTopic } from '../types';

const POLL_INTERVAL_MS = 3000;

export function KafkaContractChecksPage() {
  const [rows, setRows] = useState<KafkaContractCheckRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [transidInput, setTransidInput] = useState('');
  const [topicInput, setTopicInput] = useState<KafkaTopic | ''>('');
  const [versionInput, setVersionInput] = useState('');
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [trackedMessageId, setTrackedMessageId] = useState<string | null>(null);

  useEffect(() => {
    fetchKafkaContractChecks().then(setRows);
    const id = setInterval(() => {
      fetchKafkaContractChecks().then(setRows);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  async function handleCheck() {
    if (transidInput.trim() === '' || topicInput === '' || versionInput.trim() === '') {
      return;
    }
    try {
      await registerKafkaContractCheck({
        message_id: transidInput,
        name: transidInput,
        topic: topicInput,
        version: versionInput,
      });
      setRegisterError(null);
      setTrackedMessageId(transidInput);
    } catch {
      setRegisterError('Could not register the Kafka contract check. Please try again.');
      setTrackedMessageId(null);
    }
  }

  const trackedRow = rows.find((r) => r.message_id === trackedMessageId);

  return (
    <main className="app-main">
      <h1 className="heading-xl">Kafka Contract Checks</h1>

      <section className="card">
        {registerError && (
          <p role="alert" className="alert">
            {registerError}
          </p>
        )}
        <label className="label">
          Transaction ID
          <input className="text-input" value={transidInput} onChange={(e) => setTransidInput(e.target.value)} />
        </label>
        <label className="label">
          Kafka Topic
          <select
            className="text-input"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value as KafkaTopic | '')}
          >
            <option value="" disabled>
              — Select a topic —
            </option>
            {KAFKA_TOPICS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          Version
          <input className="text-input" value={versionInput} onChange={(e) => setVersionInput(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn-primary"
          disabled={transidInput.trim() === '' || topicInput === '' || versionInput.trim() === ''}
          onClick={handleCheck}
        >
          Check Contract
        </button>
      </section>

      {trackedMessageId && (
        <section className="card">
          <h2 className="heading-md">Result</h2>
          {!trackedRow || trackedRow.status === 'pending' ? (
            <p className="body-strong">Pending…</p>
          ) : trackedRow.status === 'passed' ? (
            <p className="body-strong">PASSED</p>
          ) : trackedRow.status === 'error' ? (
            <>
              <p className="body-strong">ERROR</p>
              <p>{trackedRow.errorMessage}</p>
            </>
          ) : (
            <p className="body-strong">FAILED</p>
          )}
        </section>
      )}

      {rows.length === 0 && <p className="body-strong">No Kafka contract checks yet.</p>}
      <ul className="step-browser-list">
        {rows.map((row) => (
          <li key={row.message_id}>
            <button
              type="button"
              className="step-browser-row"
              onClick={() => setExpanded(expanded === row.message_id ? null : row.message_id)}
            >
              <span className="step-browser-name">{row.name}</span>
              <span className="step-browser-meta">
                {row.topic} · {row.version}
              </span>
              <span className="step-browser-flows">{row.status}</span>
            </button>
            {expanded === row.message_id && (
              <pre className="code-block">
                {row.status === 'error'
                  ? row.errorMessage
                  : row.diffReport
                    ? row.diffReport.findings
                        .map(
                          (f) =>
                            `${f.severity.toUpperCase()} ${f.kind} status=${f.status}${f.field ? ` field=${f.field}` : ''}`
                        )
                        .join('\n') || 'No differences found.'
                    : 'Pending…'}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- KafkaContractChecksPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/KafkaContractChecksPage.tsx packages/web/test/components/KafkaContractChecksPage.test.tsx
git commit -m "feat(web): add KafkaContractChecksPage"
```

---

### Task 8: Sidebar, routing, and dev proxy

**Files:**
- Modify: `packages/web/src/components/Sidebar.tsx`
- Modify: `packages/web/test/components/Sidebar.test.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/vite.config.ts`

**Interfaces:**
- Consumes: `KafkaContractChecksPage` from `./components/KafkaContractChecksPage` (Task 7).
- Produces: nothing — this is the final task completing the feature end-to-end.

- [ ] **Step 1: Write the failing Sidebar tests**

Replace the entire contents of `packages/web/test/components/Sidebar.test.tsx` with:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../../src/components/Sidebar';

function renderSidebar(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Sidebar />
    </MemoryRouter>
  );
}

describe('Sidebar', () => {
  it('renders all six nav items with the correct hrefs', () => {
    renderSidebar('/');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Manage Load Reusable Step' })).toHaveAttribute('href', '/manage-steps');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).toHaveAttribute('href', '/e2e-test');
    expect(screen.getByRole('link', { name: 'API Automation' })).toHaveAttribute('href', '/api-automation');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).toHaveAttribute('href', '/kafka-checks');
    expect(screen.getByRole('link', { name: 'Kafka Contract Checks' })).toHaveAttribute(
      'href',
      '/kafka-contract-checks'
    );
  });

  it('marks Simple Mode active on the root path', () => {
    renderSidebar('/');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Manage Load Reusable Step' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'API Automation' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Kafka Contract Checks' })).not.toHaveAttribute('aria-current');
  });

  it('marks Manage Load Reusable Step active on /manage-steps, not the others', () => {
    renderSidebar('/manage-steps');
    expect(screen.getByRole('link', { name: 'Manage Load Reusable Step' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'API Automation' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Kafka Contract Checks' })).not.toHaveAttribute('aria-current');
  });

  it('marks End-to-end test active on /e2e-test, not the others', () => {
    renderSidebar('/e2e-test');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Manage Load Reusable Step' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'API Automation' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Kafka Contract Checks' })).not.toHaveAttribute('aria-current');
  });

  it('marks API Automation active on /api-automation, not the others', () => {
    renderSidebar('/api-automation');
    expect(screen.getByRole('link', { name: 'API Automation' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Manage Load Reusable Step' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Kafka Contract Checks' })).not.toHaveAttribute('aria-current');
  });

  it('marks Check Kafka active on /kafka-checks, not the others', () => {
    renderSidebar('/kafka-checks');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Manage Load Reusable Step' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'API Automation' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Kafka Contract Checks' })).not.toHaveAttribute('aria-current');
  });

  it('marks Kafka Contract Checks active on /kafka-contract-checks, not the others', () => {
    renderSidebar('/kafka-contract-checks');
    expect(screen.getByRole('link', { name: 'Kafka Contract Checks' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Manage Load Reusable Step' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'API Automation' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).not.toHaveAttribute('aria-current');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- Sidebar.test.tsx`
Expected: FAIL — the `Kafka Contract Checks` link doesn't exist yet.

- [ ] **Step 3: Add the nav link, route, and proxy entry**

Modify `packages/web/src/components/Sidebar.tsx`, changing:

```tsx
      <NavLink
        to="/kafka-checks"
        className={({ isActive }) => (isActive ? 'sidebar-link sidebar-link--active' : 'sidebar-link')}
      >
        Check Kafka
      </NavLink>
    </nav>
  );
}
```

to:

```tsx
      <NavLink
        to="/kafka-checks"
        className={({ isActive }) => (isActive ? 'sidebar-link sidebar-link--active' : 'sidebar-link')}
      >
        Check Kafka
      </NavLink>
      <NavLink
        to="/kafka-contract-checks"
        className={({ isActive }) => (isActive ? 'sidebar-link sidebar-link--active' : 'sidebar-link')}
      >
        Kafka Contract Checks
      </NavLink>
    </nav>
  );
}
```

Modify `packages/web/src/App.tsx`'s import block, changing:

```ts
import { KafkaChecksPage } from './components/KafkaChecksPage';
```

to:

```ts
import { KafkaChecksPage } from './components/KafkaChecksPage';
import { KafkaContractChecksPage } from './components/KafkaContractChecksPage';
```

Modify `packages/web/src/App.tsx`'s routes, changing:

```tsx
          <Route path="/kafka-checks" element={<KafkaChecksPage />} />
        </Routes>
```

to:

```tsx
          <Route path="/kafka-checks" element={<KafkaChecksPage />} />
          <Route path="/kafka-contract-checks" element={<KafkaContractChecksPage />} />
        </Routes>
```

Modify `packages/web/vite.config.ts`'s proxy map, changing:

```ts
      '/kafka-checks': 'http://localhost:3000',
```

to:

```ts
      '/kafka-checks': 'http://localhost:3000',
      '/kafka-contract-checks': 'http://localhost:3000',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full workspace test suite and typecheck**

Run: `pnpm test && pnpm typecheck` (from the repo root)
Expected: PASS across all six packages.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/Sidebar.tsx packages/web/test/components/Sidebar.test.tsx packages/web/src/App.tsx packages/web/vite.config.ts
git commit -m "feat(web): add Kafka Contract Checks sidebar entry, route, and dev proxy"
```
