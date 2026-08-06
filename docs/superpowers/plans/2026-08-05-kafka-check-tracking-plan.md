# Kafka Check Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Check Kafka" checkbox to Simple Mode that registers an async tracking record on Run, plus a background Kafka consumer inside `packages/server` that matches incoming messages to pending records and checks required fields, surfaced on a new "Check Kafka" page.

**Architecture:** Fully decoupled from the existing engine/dispatcher/run model — no new Runner, no new step type. A new `KafkaCheckStore` (flat JSON, mirrors `StepStore`) persists tracking rows; new `POST`/`GET /kafka-checks` routes register and list them; a long-lived `kafkajs` consumer per topic (started only from `index.ts`, never from the test-injectable `buildApp`) matches incoming messages by a per-topic correlator field and checks required-field presence; a periodic sweep times out stale PENDING rows. The web side adds a checkbox+topic-select to `RequestBuilder`, a registration call in `RunButton`, and a new list page.

**Tech Stack:** Fastify, `kafkajs`, `js-yaml` (new server deps), React 18, TypeScript, Vitest + React Testing Library + `@testing-library/user-event`.

## Global Constraints

- The REST/gRPC run itself (engine, dispatcher, `dsl.ts`, SSE event model) is **completely unchanged** — Kafka tracking is a parallel side-effect registered via a separate `POST /kafka-checks` call, never a new engine step/Runner.
- `buildApp()` must **never** start the Kafka consumer — consumer startup happens only in `index.ts`. This is a hard safety boundary: every route/store test uses `buildApp()`, and none of them may touch a real Kafka connection.
- The tracking record's `message_id` **is** the correlator value pulled from the request body/gRPC message — no separate tracking ID is generated.
- Per-topic correlator field + required-fields list live in TypeScript (`kafka-check-definitions.ts`), not in the yaml — they're business rules, not infrastructure config.
- Real broker/topic/groupID config lives in a gitignored `packages/server/config/kafka.yaml`; a `.example` template with placeholder values is committed.
- Status model: `pending` → `received` → `passed` (all required fields present) or `failed` (missing fields, OR no message arrived within 60 seconds — `retry_count` increments once per timeout sweep that finds it still pending).
- Field presence means "the key exists in the parsed JSON," regardless of whether its value is empty/null/falsy. Nested objects (e.g. `additionalTransInfo`) are checked as a single key, not expanded.
- Three topics are fully implemented this increment: `transLogV1` (correlator `appTransID`), `refundLog` (correlator `appTransID`), `paymentAuth` (correlator `order_no`). `disburseLog` is out of scope — no UI option, no checking.
- `disburseLog`'s correlator/field list for `paymentAuth` is a best-guess default per the approved spec, not confirmed against a real request shape — implement as specified; do not add extra speculative configurability beyond what's listed here.

---

### Task 1: Kafka check definitions + pure field/correlation logic

**Files:**
- Create: `packages/server/src/kafka-check-definitions.ts`
- Create: `packages/server/src/kafka-check-logic.ts`
- Test: `packages/server/test/kafka-check-logic.test.ts`

**Interfaces:**
- Produces: `KafkaTopicKey` (`'transLogV1' | 'refundLog' | 'paymentAuth'`), `KAFKA_TOPIC_KEYS: KafkaTopicKey[]`, `KAFKA_TOPIC_DEFINITIONS: Record<KafkaTopicKey, { correlatorField: string; hasDataWrapper: boolean; requiredFields: string[] }>` from `kafka-check-definitions.ts`. `extractCorrelatorValue(message: unknown, topic: KafkaTopicKey): string | undefined`, `checkRequiredFields(message: unknown, topic: KafkaTopicKey): string[]`, `isTimedOut(row: { status: string; created_at: string }, nowMs: number, timeoutMs: number): boolean` from `kafka-check-logic.ts`. Task 5 imports all of these.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/kafka-check-logic.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractCorrelatorValue, checkRequiredFields, isTimedOut } from '../src/kafka-check-logic.js';

const TRANS_LOG_MESSAGE = {
  logType: 1,
  data: {
    transID: 1,
    appID: 2553,
    appTransID: 'tx-abc',
    amount: 10000,
    status: 'SUCCESS',
  },
};

const PAYMENT_AUTH_MESSAGE = {
  order_no: 'order-1',
  payment_no: 'pay-1',
  status: 'PROCESSING',
};

describe('extractCorrelatorValue', () => {
  it('reads the correlator field out of the data wrapper for transLogV1', () => {
    expect(extractCorrelatorValue(TRANS_LOG_MESSAGE, 'transLogV1')).toBe('tx-abc');
  });

  it('reads the correlator field at the top level for paymentAuth', () => {
    expect(extractCorrelatorValue(PAYMENT_AUTH_MESSAGE, 'paymentAuth')).toBe('order-1');
  });

  it('returns undefined when the correlator field is missing', () => {
    expect(extractCorrelatorValue({ data: {} }, 'transLogV1')).toBeUndefined();
  });

  it('returns undefined when the data wrapper is missing', () => {
    expect(extractCorrelatorValue({}, 'transLogV1')).toBeUndefined();
  });

  it('returns undefined for a non-object message', () => {
    expect(extractCorrelatorValue('not json', 'transLogV1')).toBeUndefined();
  });

  it('stringifies a numeric correlator value', () => {
    expect(extractCorrelatorValue({ data: { appTransID: 12345 } }, 'transLogV1')).toBe('12345');
  });
});

describe('checkRequiredFields', () => {
  it('returns an empty array when every required field is present', () => {
    const message = {
      data: Object.fromEntries(
        [
          'transID', 'appID', 'transType', 'pmcID', 'amount', 'userChargeAmount', 'userFeeAmount',
          'transStatus', 'status', 'userID', 'appTransID', 'isFullFlow', 'authInfo', 'merchantCategoryCode',
          'productType', 'orderNo', 'paymentNo', 'paymentMethod', 'destTxnStatus', 'sourceTxnStatus',
          'destAssetType', 'destAssetData', 'sourceAssetData',
        ].map((field) => [field, 'x'])
      ),
    };
    expect(checkRequiredFields(message, 'transLogV1')).toEqual([]);
  });

  it('lists every missing field', () => {
    expect(checkRequiredFields({ data: { transID: 1 } }, 'transLogV1')).toEqual(
      expect.arrayContaining(['appID', 'appTransID', 'status'])
    );
    expect(checkRequiredFields({ data: { transID: 1 } }, 'transLogV1')).not.toContain('transID');
  });

  it('treats an empty-string value as present', () => {
    expect(checkRequiredFields({ data: { transID: '' } }, 'transLogV1')).not.toContain('transID');
  });

  it('checks a nested object field as present without expanding it', () => {
    expect(
      checkRequiredFields({ data: { additionalTransInfo: { payment_method: 'WBL' } } }, 'refundLog')
    ).not.toContain('additionalTransInfo');
  });

  it('checks fields at the top level for paymentAuth (no data wrapper)', () => {
    const missing = checkRequiredFields({ order_no: 'o1' }, 'paymentAuth');
    expect(missing).toContain('payment_no');
    expect(missing).not.toContain('order_no');
  });

  it('returns the full required-fields list when the message has no usable payload', () => {
    expect(checkRequiredFields({}, 'transLogV1')).toHaveLength(23);
  });
});

describe('isTimedOut', () => {
  it('is false for a pending row within the timeout window', () => {
    const row = { status: 'pending', created_at: new Date(1000).toISOString() };
    expect(isTimedOut(row, 1000 + 30_000, 60_000)).toBe(false);
  });

  it('is true for a pending row past the timeout window', () => {
    const row = { status: 'pending', created_at: new Date(1000).toISOString() };
    expect(isTimedOut(row, 1000 + 60_001, 60_000)).toBe(true);
  });

  it('is false for a non-pending row regardless of age', () => {
    const row = { status: 'passed', created_at: new Date(1000).toISOString() };
    expect(isTimedOut(row, 1000 + 999_999, 60_000)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/server test -- kafka-check-logic.test.ts`
Expected: FAIL — cannot find module `../src/kafka-check-logic.js`.

- [ ] **Step 3: Write the definitions**

Create `packages/server/src/kafka-check-definitions.ts`:

```ts
export type KafkaTopicKey = 'transLogV1' | 'refundLog' | 'paymentAuth';

export const KAFKA_TOPIC_KEYS: KafkaTopicKey[] = ['transLogV1', 'refundLog', 'paymentAuth'];

export interface KafkaTopicDefinition {
  correlatorField: string;
  hasDataWrapper: boolean;
  requiredFields: string[];
}

export const KAFKA_TOPIC_DEFINITIONS: Record<KafkaTopicKey, KafkaTopicDefinition> = {
  transLogV1: {
    correlatorField: 'appTransID',
    hasDataWrapper: true,
    requiredFields: [
      'transID', 'appID', 'transType', 'pmcID', 'amount', 'userChargeAmount', 'userFeeAmount',
      'transStatus', 'status', 'userID', 'appTransID', 'isFullFlow', 'authInfo', 'merchantCategoryCode',
      'productType', 'orderNo', 'paymentNo', 'paymentMethod', 'destTxnStatus', 'sourceTxnStatus',
      'destAssetType', 'destAssetData', 'sourceAssetData',
    ],
  },
  refundLog: {
    correlatorField: 'appTransID',
    hasDataWrapper: true,
    requiredFields: [
      'transID', 'appID', 'appTransID', 'transType', 'pmcID', 'amount', 'userChargeAmount', 'userFeeAmount',
      'transStatus', 'bankCode', 'ccBankCode', 'refundType', 'refundStatus', 'internalRefundStatus',
      'refundCaller', 'refundAmount', 'requestRefundAmount', 'requestRefundFeeAmount', 'refundReasonType',
      'refundResponse', 'refundID', 'refundBeginDate', 'refundEndDate', 'mRefundID', 'isRefundByChargeAmount',
      'callApiBeginDate', 'callApiEndDate', 'isFinal', 'discountAmount', 'remainingAmount', 'userId',
      'refundDescription', 'applyRevamp', 'promotionRefundAmount', 'userFeeRefundAmount', 'productCode',
      'eventCode', 'mcc', 'additionalTransInfo', 'eventContext', 'paymentNo', 'status', 'internalStatus',
    ],
  },
  paymentAuth: {
    correlatorField: 'order_no',
    hasDataWrapper: false,
    requiredFields: [
      'payment_no', 'order_no', 'auth_session_id', 'auth_data', 'trans_id', 'fund_type', 'detail_reason',
      'transaction',
    ],
  },
};
```

- [ ] **Step 4: Write the pure logic functions**

Create `packages/server/src/kafka-check-logic.ts`:

```ts
import { KAFKA_TOPIC_DEFINITIONS, type KafkaTopicKey } from './kafka-check-definitions.js';

function payloadOf(message: unknown, topic: KafkaTopicKey): Record<string, unknown> | undefined {
  const definition = KAFKA_TOPIC_DEFINITIONS[topic];
  if (typeof message !== 'object' || message === null) {
    return undefined;
  }
  const record = message as Record<string, unknown>;
  if (!definition.hasDataWrapper) {
    return record;
  }
  const data = record.data;
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : undefined;
}

export function extractCorrelatorValue(message: unknown, topic: KafkaTopicKey): string | undefined {
  const payload = payloadOf(message, topic);
  if (!payload) {
    return undefined;
  }
  const value = payload[KAFKA_TOPIC_DEFINITIONS[topic].correlatorField];
  return value === undefined || value === null ? undefined : String(value);
}

export function checkRequiredFields(message: unknown, topic: KafkaTopicKey): string[] {
  const definition = KAFKA_TOPIC_DEFINITIONS[topic];
  const payload = payloadOf(message, topic);
  if (!payload) {
    return [...definition.requiredFields];
  }
  return definition.requiredFields.filter((field) => !(field in payload));
}

export function isTimedOut(
  row: { status: string; created_at: string },
  nowMs: number,
  timeoutMs: number
): boolean {
  return row.status === 'pending' && nowMs - new Date(row.created_at).getTime() > timeoutMs;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/server test -- kafka-check-logic.test.ts`
Expected: PASS (15 tests)

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/server typecheck`

```bash
git add packages/server/src/kafka-check-definitions.ts packages/server/src/kafka-check-logic.ts packages/server/test/kafka-check-logic.test.ts
git commit -m "feat(server): add Kafka check field definitions and pure correlation/field logic"
```

---

### Task 2: `KafkaCheckStore`

**Files:**
- Create: `packages/server/src/kafka-check-store.ts`
- Test: `packages/server/test/kafka-check-store.test.ts`

**Interfaces:**
- Produces: `KafkaCheckStatus`, `KafkaCheckRow`, `KafkaCheckStore` (`list(): Promise<KafkaCheckRow[]>`, `get(messageId): Promise<KafkaCheckRow | undefined>`, `create(row): Promise<void>`, `update(messageId, patch): Promise<KafkaCheckRow | undefined>`). Task 3 (routes) and Task 5 (consumer) both consume this class directly.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/kafka-check-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KafkaCheckStore, type KafkaCheckRow } from '../src/kafka-check-store.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kafka-check-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function sampleRow(overrides: Partial<KafkaCheckRow> = {}): KafkaCheckRow {
  return {
    message_id: 'tx-1',
    name: 'Create Payment',
    topic: 'transLogV1',
    status: 'pending',
    missingFields: [],
    matchedMessage: null,
    created_at: '2026-08-05T00:00:00.000Z',
    updated_at: '2026-08-05T00:00:00.000Z',
    retry_count: 0,
    ...overrides,
  };
}

describe('KafkaCheckStore', () => {
  it('returns an empty list and creates the file when it does not exist yet', async () => {
    const store = new KafkaCheckStore(join(dir, 'kafka-checks.json'));
    expect(await store.list()).toEqual([]);
    const contents = await readFile(join(dir, 'kafka-checks.json'), 'utf8');
    expect(JSON.parse(contents)).toEqual({});
  });

  it('creates and retrieves a row by message_id', async () => {
    const store = new KafkaCheckStore(join(dir, 'kafka-checks.json'));
    await store.create(sampleRow());
    expect(await store.get('tx-1')).toEqual(sampleRow());
  });

  it('returns undefined for an unknown message_id', async () => {
    const store = new KafkaCheckStore(join(dir, 'kafka-checks.json'));
    expect(await store.get('missing')).toBeUndefined();
  });

  it('lists rows newest-created first', async () => {
    const store = new KafkaCheckStore(join(dir, 'kafka-checks.json'));
    await store.create(sampleRow({ message_id: 'tx-1', created_at: '2026-08-05T00:00:00.000Z' }));
    await store.create(sampleRow({ message_id: 'tx-2', created_at: '2026-08-05T00:00:05.000Z' }));
    const rows = await store.list();
    expect(rows.map((r) => r.message_id)).toEqual(['tx-2', 'tx-1']);
  });

  it('update merges a patch and bumps updated_at, returning the updated row', async () => {
    const store = new KafkaCheckStore(join(dir, 'kafka-checks.json'));
    await store.create(sampleRow());
    const updated = await store.update('tx-1', { status: 'passed' });
    expect(updated?.status).toBe('passed');
    expect(updated?.updated_at).not.toBe('2026-08-05T00:00:00.000Z');
    expect(await store.get('tx-1')).toEqual(updated);
  });

  it('update returns undefined for an unknown message_id and does not create a row', async () => {
    const store = new KafkaCheckStore(join(dir, 'kafka-checks.json'));
    expect(await store.update('missing', { status: 'failed' })).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it('persists across separate store instances pointed at the same file', async () => {
    const filePath = join(dir, 'kafka-checks.json');
    const first = new KafkaCheckStore(filePath);
    await first.create(sampleRow());

    const second = new KafkaCheckStore(filePath);
    expect(await second.get('tx-1')).toEqual(sampleRow());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/server test -- kafka-check-store.test.ts`
Expected: FAIL — cannot find module `../src/kafka-check-store.js`.

- [ ] **Step 3: Write the store**

Create `packages/server/src/kafka-check-store.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type KafkaCheckStatus = 'pending' | 'received' | 'passed' | 'failed';

export interface KafkaCheckRow {
  message_id: string;
  name: string;
  topic: string;
  status: KafkaCheckStatus;
  missingFields: string[];
  matchedMessage: unknown;
  created_at: string;
  updated_at: string;
  retry_count: number;
}

export class KafkaCheckStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<KafkaCheckRow[]> {
    const map = await this.readMap();
    return Object.values(map).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  async get(messageId: string): Promise<KafkaCheckRow | undefined> {
    const map = await this.readMap();
    return map[messageId];
  }

  async create(row: KafkaCheckRow): Promise<void> {
    const map = await this.readMap();
    map[row.message_id] = row;
    await this.write(map);
  }

  async update(messageId: string, patch: Partial<KafkaCheckRow>): Promise<KafkaCheckRow | undefined> {
    const map = await this.readMap();
    const existing = map[messageId];
    if (!existing) {
      return undefined;
    }
    const updated: KafkaCheckRow = { ...existing, ...patch, updated_at: new Date().toISOString() };
    map[messageId] = updated;
    await this.write(map);
    return updated;
  }

  private async readMap(): Promise<Record<string, KafkaCheckRow>> {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      return JSON.parse(contents) as Record<string, KafkaCheckRow>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.write({});
        return {};
      }
      throw err;
    }
  }

  private async write(map: Record<string, KafkaCheckRow>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(map, null, 2));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/server test -- kafka-check-store.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/server typecheck`

```bash
git add packages/server/src/kafka-check-store.ts packages/server/test/kafka-check-store.test.ts
git commit -m "feat(server): add KafkaCheckStore"
```

---

### Task 3: `POST`/`GET /kafka-checks` routes

**Files:**
- Create: `packages/server/src/routes/kafka-checks.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/test/kafka-checks-routes.test.ts`

**Interfaces:**
- Consumes: `KafkaCheckStore` (Task 2), `KAFKA_TOPIC_KEYS`/`KafkaTopicKey` (Task 1).
- Produces: `registerKafkaCheckRoutes(app: FastifyInstance, store: KafkaCheckStore): void`. Exports `DEFAULT_DATA_DIR: string` from `app.ts` (currently a local unexported const) — Task 5's `index.ts` wiring needs this to point its own `KafkaCheckStore` instance at the same `data/` directory `buildApp()` uses.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/kafka-checks-routes.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';

let dir: string | undefined;

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

async function buildTestApp() {
  dir = await mkdtemp(join(tmpdir(), 'kafka-checks-routes-'));
  return buildApp({ dataDir: dir });
}

describe('GET /kafka-checks', () => {
  it('returns an empty list when nothing has been registered yet', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/kafka-checks' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('lists registered checks newest-first', async () => {
    const app = await buildTestApp();
    await app.inject({
      method: 'POST',
      url: '/kafka-checks',
      payload: { message_id: 'tx-1', name: 'First', topic: 'transLogV1' },
    });
    await app.inject({
      method: 'POST',
      url: '/kafka-checks',
      payload: { message_id: 'tx-2', name: 'Second', topic: 'refundLog' },
    });
    const res = await app.inject({ method: 'GET', url: '/kafka-checks' });
    expect(res.json().map((row: { message_id: string }) => row.message_id)).toEqual(['tx-2', 'tx-1']);
  });
});

describe('POST /kafka-checks', () => {
  it('creates a pending row and returns it with 201', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-checks',
      payload: { message_id: 'tx-1', name: 'Create Payment', topic: 'transLogV1' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      message_id: 'tx-1',
      name: 'Create Payment',
      topic: 'transLogV1',
      status: 'pending',
      missingFields: [],
      matchedMessage: null,
      retry_count: 0,
    });
    expect(typeof body.created_at).toBe('string');
  });

  it('rejects a blank message_id with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-checks',
      payload: { message_id: '  ', name: 'x', topic: 'transLogV1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a blank name with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-checks',
      payload: { message_id: 'tx-1', name: '  ', topic: 'transLogV1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown topic with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-checks',
      payload: { message_id: 'tx-1', name: 'x', topic: 'disburseLog' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('overwrites an existing row back to pending when the same message_id is registered again', async () => {
    const app = await buildTestApp();
    await app.inject({
      method: 'POST',
      url: '/kafka-checks',
      payload: { message_id: 'tx-1', name: 'First', topic: 'transLogV1' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/kafka-checks',
      payload: { message_id: 'tx-1', name: 'First retried', topic: 'transLogV1' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('First retried');
    const list = await app.inject({ method: 'GET', url: '/kafka-checks' });
    expect(list.json()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/server test -- kafka-checks-routes.test.ts`
Expected: FAIL — cannot find module `../src/routes/kafka-checks.js` (and `buildApp` doesn't wire it yet).

- [ ] **Step 3: Write the routes**

Create `packages/server/src/routes/kafka-checks.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { KafkaCheckStore } from '../kafka-check-store.js';
import { KAFKA_TOPIC_KEYS, type KafkaTopicKey } from '../kafka-check-definitions.js';

export function registerKafkaCheckRoutes(app: FastifyInstance, store: KafkaCheckStore): void {
  app.get('/kafka-checks', async () => store.list());

  app.post('/kafka-checks', async (request, reply) => {
    const { message_id, name, topic } = (request.body ?? {}) as {
      message_id?: string;
      name?: string;
      topic?: string;
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
    const now = new Date().toISOString();
    const row = {
      message_id,
      name,
      topic,
      status: 'pending' as const,
      missingFields: [],
      matchedMessage: null,
      created_at: now,
      updated_at: now,
      retry_count: 0,
    };
    await store.create(row);
    return reply.code(201).send(row);
  });
}
```

- [ ] **Step 4: Wire the store and routes into `app.ts`**

In `packages/server/src/app.ts`, change `const DEFAULT_DATA_DIR = ...` to `export const DEFAULT_DATA_DIR = ...`, add the imports:

```ts
import { KafkaCheckStore } from './kafka-check-store.js';
import { registerKafkaCheckRoutes } from './routes/kafka-checks.js';
```

and, inside `buildApp`, after the `flowStore`/`registerFlowRoutes` lines:

```ts
  const kafkaCheckStore = new KafkaCheckStore(join(dataDir, 'kafka-checks.json'));
  registerKafkaCheckRoutes(app, kafkaCheckStore);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/server test -- kafka-checks-routes.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Run the full server test suite and typecheck**

Run: `pnpm --filter @ai-native-testing/server test`
Run: `pnpm --filter @ai-native-testing/server typecheck`
Expected: PASS / no errors

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/kafka-checks.ts packages/server/src/app.ts packages/server/test/kafka-checks-routes.test.ts
git commit -m "feat(server): add POST/GET /kafka-checks routes"
```

---

### Task 4: Kafka yaml config loader

**Files:**
- Create: `packages/server/src/kafka-config.ts`
- Create: `packages/server/config/kafka.yaml.example`
- Modify: `packages/server/package.json`
- Modify: `.gitignore` (repo root)
- Test: `packages/server/test/kafka-config.test.ts`

**Interfaces:**
- Produces: `KafkaTopicConfig` (`{brokers: string[]; topic: string}`), `KafkaConfig` (`{groupID: string; topics: Record<KafkaTopicKey, KafkaTopicConfig>}`), `loadKafkaConfig(filePath: string): KafkaConfig | undefined`. Task 5's `index.ts` wiring calls this.

- [ ] **Step 1: Add dependencies**

In `packages/server/package.json`, add to `"dependencies"`: `"js-yaml": "^4.1.0"`, `"kafkajs": "^2.2.4"`. Add to `"devDependencies"`: `"@types/js-yaml": "^4.0.9"`.

Run: `pnpm install`

- [ ] **Step 2: Write the failing test**

Create `packages/server/test/kafka-config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadKafkaConfig } from '../src/kafka-config.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kafka-config-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const SAMPLE_YAML = `
groupID: automation_local
transLogV1:
  brokers: 10.50.1.6:9092,10.50.1.7:9092
  topic: ZPReportTransLogQC
refundLog:
  brokers: 10.60.45.2:9092
  topic: ZPReportTransLog
paymentAuth:
  brokers: 10.60.45.2:9092
  topic: payment_authentication_auth_session_status_qc
disburseLog:
  brokers: 10.60.45.2:9092
  topic: td-transfer-disbursement-order-status-qc
`;

describe('loadKafkaConfig', () => {
  it('parses groupID and splits comma-separated brokers into an array per topic', async () => {
    const filePath = join(dir, 'kafka.yaml');
    await writeFile(filePath, SAMPLE_YAML);

    const config = loadKafkaConfig(filePath);

    expect(config?.groupID).toBe('automation_local');
    expect(config?.topics.transLogV1).toEqual({
      brokers: ['10.50.1.6:9092', '10.50.1.7:9092'],
      topic: 'ZPReportTransLogQC',
    });
    expect(config?.topics.refundLog).toEqual({ brokers: ['10.60.45.2:9092'], topic: 'ZPReportTransLog' });
    expect(config?.topics.paymentAuth).toEqual({
      brokers: ['10.60.45.2:9092'],
      topic: 'payment_authentication_auth_session_status_qc',
    });
  });

  it('returns undefined when the file does not exist', () => {
    expect(loadKafkaConfig(join(dir, 'missing.yaml'))).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/server test -- kafka-config.test.ts`
Expected: FAIL — cannot find module `../src/kafka-config.js`.

- [ ] **Step 4: Write the loader**

Create `packages/server/src/kafka-config.ts`:

```ts
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import type { KafkaTopicKey } from './kafka-check-definitions.js';

export interface KafkaTopicConfig {
  brokers: string[];
  topic: string;
}

export interface KafkaConfig {
  groupID: string;
  topics: Record<KafkaTopicKey, KafkaTopicConfig>;
}

interface RawTopicConfig {
  brokers: string;
  topic: string;
}

interface RawKafkaYaml {
  groupID: string;
  transLogV1: RawTopicConfig;
  refundLog: RawTopicConfig;
  paymentAuth: RawTopicConfig;
  disburseLog?: RawTopicConfig;
}

function toTopicConfig(raw: RawTopicConfig): KafkaTopicConfig {
  return { brokers: raw.brokers.split(',').map((broker) => broker.trim()), topic: raw.topic };
}

export function loadKafkaConfig(filePath: string): KafkaConfig | undefined {
  let contents: string;
  try {
    contents = readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
  const raw = load(contents) as RawKafkaYaml;
  return {
    groupID: raw.groupID,
    topics: {
      transLogV1: toTopicConfig(raw.transLogV1),
      refundLog: toTopicConfig(raw.refundLog),
      paymentAuth: toTopicConfig(raw.paymentAuth),
    },
  };
}
```

- [ ] **Step 5: Add the example config template and gitignore the real file**

Create `packages/server/config/kafka.yaml.example`:

```yaml
groupID: automation_local
transLogV1:
  brokers: localhost:9092
  topic: ZPReportTransLogQC
refundLog:
  brokers: localhost:9092
  topic: ZPReportTransLog
paymentAuth:
  brokers: localhost:9092
  topic: payment_authentication_auth_session_status_qc
disburseLog:
  brokers: localhost:9092
  topic: td-transfer-disbursement-order-status-qc
```

In `.gitignore` (repo root), add a line:

```
packages/server/config/kafka.yaml
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/server test -- kafka-config.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/server typecheck`

```bash
git add packages/server/src/kafka-config.ts packages/server/config/kafka.yaml.example packages/server/package.json pnpm-lock.yaml .gitignore packages/server/test/kafka-config.test.ts
git commit -m "feat(server): add Kafka yaml config loader"
```

---

### Task 5: Kafka consumer (message matching + timeout sweep) and server bootstrap wiring

**Files:**
- Create: `packages/server/src/kafka-consumer.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/test/kafka-consumer.test.ts`

**Interfaces:**
- Consumes: `KafkaCheckStore` (Task 2), `extractCorrelatorValue`/`checkRequiredFields`/`isTimedOut` (Task 1), `KAFKA_TOPIC_KEYS` (Task 1), `KafkaConfig`/`loadKafkaConfig` (Task 4), `DEFAULT_DATA_DIR`/`buildApp` (Task 3).
- Produces: `handleIncomingMessage(topic: KafkaTopicKey, rawValue: string, store: KafkaCheckStore): Promise<void>`, `sweepTimedOutChecks(store: KafkaCheckStore): Promise<void>`, `startKafkaConsumers(config: KafkaConfig, store: KafkaCheckStore): Promise<void>`. Nothing later in the plan consumes these — this is the final backend piece.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/kafka-consumer.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KafkaCheckStore, type KafkaCheckRow } from '../src/kafka-check-store.js';
import { handleIncomingMessage, sweepTimedOutChecks } from '../src/kafka-consumer.js';

let dir: string;
let store: KafkaCheckStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kafka-consumer-'));
  store = new KafkaCheckStore(join(dir, 'kafka-checks.json'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function pendingRow(overrides: Partial<KafkaCheckRow> = {}): KafkaCheckRow {
  return {
    message_id: 'tx-1',
    name: 'Create Payment',
    topic: 'transLogV1',
    status: 'pending',
    missingFields: [],
    matchedMessage: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    retry_count: 0,
    ...overrides,
  };
}

describe('handleIncomingMessage', () => {
  it('marks a matching pending row passed when every required field is present', async () => {
    await store.create(pendingRow());
    const message = {
      data: Object.fromEntries(
        [
          'transID', 'appID', 'transType', 'pmcID', 'amount', 'userChargeAmount', 'userFeeAmount',
          'transStatus', 'status', 'userID', 'appTransID', 'isFullFlow', 'authInfo', 'merchantCategoryCode',
          'productType', 'orderNo', 'paymentNo', 'paymentMethod', 'destTxnStatus', 'sourceTxnStatus',
          'destAssetType', 'destAssetData', 'sourceAssetData',
        ].map((field) => [field, 'x'])
      ),
    };
    message.data.appTransID = 'tx-1';

    await handleIncomingMessage('transLogV1', JSON.stringify(message), store);

    const row = await store.get('tx-1');
    expect(row?.status).toBe('passed');
    expect(row?.missingFields).toEqual([]);
    expect(row?.matchedMessage).toEqual(message);
  });

  it('marks a matching pending row failed with the missing fields when some are absent', async () => {
    await store.create(pendingRow());
    const message = { data: { appTransID: 'tx-1', transID: 1 } };

    await handleIncomingMessage('transLogV1', JSON.stringify(message), store);

    const row = await store.get('tx-1');
    expect(row?.status).toBe('failed');
    expect(row?.missingFields).toContain('appID');
  });

  it('ignores a message whose correlator does not match any pending row', async () => {
    await store.create(pendingRow());
    await handleIncomingMessage('transLogV1', JSON.stringify({ data: { appTransID: 'unknown' } }), store);
    expect((await store.get('tx-1'))?.status).toBe('pending');
  });

  it('ignores a message for a row already resolved (does not reprocess)', async () => {
    await store.create(pendingRow({ status: 'passed' }));
    await handleIncomingMessage('transLogV1', JSON.stringify({ data: { appTransID: 'tx-1' } }), store);
    expect((await store.get('tx-1'))?.status).toBe('passed');
  });

  it('ignores a message whose topic does not match the row it would otherwise correlate to', async () => {
    await store.create(pendingRow({ topic: 'refundLog' }));
    await handleIncomingMessage('transLogV1', JSON.stringify({ data: { appTransID: 'tx-1' } }), store);
    expect((await store.get('tx-1'))?.status).toBe('pending');
  });

  it('silently ignores malformed JSON', async () => {
    await store.create(pendingRow());
    await expect(handleIncomingMessage('transLogV1', 'not json', store)).resolves.toBeUndefined();
    expect((await store.get('tx-1'))?.status).toBe('pending');
  });
});

describe('sweepTimedOutChecks', () => {
  it('marks a stale pending row failed and increments retry_count', async () => {
    await store.create(pendingRow({ created_at: new Date(Date.now() - 61_000).toISOString() }));
    await sweepTimedOutChecks(store);
    const row = await store.get('tx-1');
    expect(row?.status).toBe('failed');
    expect(row?.missingFields).toEqual(['(timeout: no message received)']);
    expect(row?.retry_count).toBe(1);
  });

  it('leaves a recent pending row untouched', async () => {
    await store.create(pendingRow({ created_at: new Date().toISOString() }));
    await sweepTimedOutChecks(store);
    expect((await store.get('tx-1'))?.status).toBe('pending');
  });

  it('leaves an already-resolved row untouched', async () => {
    await store.create(
      pendingRow({ status: 'passed', created_at: new Date(Date.now() - 61_000).toISOString() })
    );
    await sweepTimedOutChecks(store);
    expect((await store.get('tx-1'))?.status).toBe('passed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/server test -- kafka-consumer.test.ts`
Expected: FAIL — cannot find module `../src/kafka-consumer.js`.

- [ ] **Step 3: Write the consumer module**

Create `packages/server/src/kafka-consumer.ts`:

```ts
import { Kafka } from 'kafkajs';
import type { KafkaConfig } from './kafka-config.js';
import { KAFKA_TOPIC_KEYS, type KafkaTopicKey } from './kafka-check-definitions.js';
import { extractCorrelatorValue, checkRequiredFields, isTimedOut } from './kafka-check-logic.js';
import type { KafkaCheckStore } from './kafka-check-store.js';

const TIMEOUT_MS = 60_000;
const SWEEP_INTERVAL_MS = 5_000;

export async function handleIncomingMessage(
  topic: KafkaTopicKey,
  rawValue: string,
  store: KafkaCheckStore
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return;
  }

  const correlatorValue = extractCorrelatorValue(parsed, topic);
  if (correlatorValue === undefined) {
    return;
  }

  const row = await store.get(correlatorValue);
  if (!row || row.topic !== topic || row.status !== 'pending') {
    return;
  }

  await store.update(correlatorValue, { status: 'received' });
  const missingFields = checkRequiredFields(parsed, topic);
  await store.update(correlatorValue, {
    status: missingFields.length === 0 ? 'passed' : 'failed',
    missingFields,
    matchedMessage: parsed,
  });
}

export async function sweepTimedOutChecks(store: KafkaCheckStore): Promise<void> {
  const rows = await store.list();
  const now = Date.now();
  for (const row of rows) {
    if (isTimedOut(row, now, TIMEOUT_MS)) {
      await store.update(row.message_id, {
        status: 'failed',
        missingFields: ['(timeout: no message received)'],
        retry_count: row.retry_count + 1,
      });
    }
  }
}

export async function startKafkaConsumers(config: KafkaConfig, store: KafkaCheckStore): Promise<void> {
  for (const topicKey of KAFKA_TOPIC_KEYS) {
    const topicConfig = config.topics[topicKey];
    const kafka = new Kafka({ brokers: topicConfig.brokers });
    const consumer = kafka.consumer({ groupId: `${config.groupID}-${topicKey}` });
    await consumer.connect();
    await consumer.subscribe({ topic: topicConfig.topic, fromBeginning: false });
    await consumer.run({
      eachMessage: async ({ message }) => {
        await handleIncomingMessage(topicKey, message.value?.toString('utf8') ?? '', store);
      },
    });
  }

  setInterval(() => {
    sweepTimedOutChecks(store).catch(() => {
      // Best-effort sweep; a failed sweep cycle is retried on the next interval tick.
    });
  }, SWEEP_INTERVAL_MS);
}
```

- [ ] **Step 4: Wire into `index.ts`**

Replace the full contents of `packages/server/src/index.ts` with:

```ts
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp, DEFAULT_DATA_DIR } from './app.js';
import { loadKafkaConfig } from './kafka-config.js';
import { KafkaCheckStore } from './kafka-check-store.js';
import { startKafkaConsumers } from './kafka-consumer.js';

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: '0.0.0.0' }).then(() => {
  app.log.info(`server listening on port ${port}`);
});

const kafkaConfigPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'kafka.yaml');
const kafkaConfig = loadKafkaConfig(kafkaConfigPath);
if (kafkaConfig) {
  const kafkaCheckStore = new KafkaCheckStore(join(DEFAULT_DATA_DIR, 'kafka-checks.json'));
  startKafkaConsumers(kafkaConfig, kafkaCheckStore).catch((err) => {
    app.log.error(err, 'Failed to start Kafka consumers');
  });
} else {
  app.log.warn('Kafka check config not found at config/kafka.yaml — Check Kafka feature disabled');
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/server test -- kafka-consumer.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 6: Run the full server test suite and typecheck**

Run: `pnpm --filter @ai-native-testing/server test`
Run: `pnpm --filter @ai-native-testing/server typecheck`
Expected: PASS / no errors

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/kafka-consumer.ts packages/server/src/index.ts packages/server/test/kafka-consumer.test.ts
git commit -m "feat(server): add Kafka consumer with field matching and timeout sweep"
```

---

### Task 6: Web `types.ts` additions and `kafkaChecks.ts` client

**Files:**
- Modify: `packages/web/src/types.ts`
- Create: `packages/web/src/kafkaChecks.ts`
- Test: `packages/web/test/kafkaChecks.test.ts`

**Interfaces:**
- Produces: `KafkaTopic` (`'transLogV1' | 'refundLog' | 'paymentAuth'`), `KAFKA_TOPICS: KafkaTopic[]`, `KafkaCheckFormState` (`{enabled: boolean; topic: KafkaTopic}`) added to `types.ts`; `FormState` gains `kafkaCheck: KafkaCheckFormState`. `correlatorFieldFor(topic: KafkaTopic): string`, `extractCorrelatorValue(form: FormState, topic: KafkaTopic): string | undefined`, `KafkaCheckRow`, `registerKafkaCheck(params): Promise<void>`, `fetchKafkaChecks(): Promise<KafkaCheckRow[]>` from `kafkaChecks.ts`. Task 7 (RequestBuilder/RunButton/App.tsx) and Task 8 (KafkaChecksPage) both import from here.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/kafkaChecks.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractCorrelatorValue, registerKafkaCheck, fetchKafkaChecks } from '../src/kafkaChecks';
import type { FormState } from '../src/types';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function sampleForm(overrides: Partial<FormState> = {}): FormState {
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
      secure: true,
      skipCertVerification: false,
    },
    extracts: [],
    questions: [],
    kafkaCheck: { enabled: false, topic: 'transLogV1' },
    ...overrides,
  };
}

describe('extractCorrelatorValue', () => {
  it('reads appTransID out of the REST body for transLogV1', () => {
    const form = sampleForm({ body: '{"appTransID":"tx-123"}' });
    expect(extractCorrelatorValue(form, 'transLogV1')).toBe('tx-123');
  });

  it('reads order_no out of the REST body for paymentAuth', () => {
    const form = sampleForm({ body: '{"order_no":"order-1"}' });
    expect(extractCorrelatorValue(form, 'paymentAuth')).toBe('order-1');
  });

  it('reads the correlator out of the gRPC message when protocol is grpc', () => {
    const form = sampleForm({
      protocol: 'grpc',
      grpc: { ...sampleForm().grpc, requestMessage: '{"appTransID":"tx-grpc"}' },
    });
    expect(extractCorrelatorValue(form, 'transLogV1')).toBe('tx-grpc');
  });

  it('returns undefined when the field is missing', () => {
    const form = sampleForm({ body: '{"other":"x"}' });
    expect(extractCorrelatorValue(form, 'transLogV1')).toBeUndefined();
  });

  it('returns undefined for an empty body', () => {
    const form = sampleForm({ body: '' });
    expect(extractCorrelatorValue(form, 'transLogV1')).toBeUndefined();
  });

  it('returns undefined for malformed JSON', () => {
    const form = sampleForm({ body: '{not json' });
    expect(extractCorrelatorValue(form, 'transLogV1')).toBeUndefined();
  });
});

describe('registerKafkaCheck', () => {
  it('POSTs the message_id, name, and topic', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);

    await registerKafkaCheck({ message_id: 'tx-1', name: 'Create Payment', topic: 'transLogV1' });

    expect(fetchMock).toHaveBeenCalledWith('/kafka-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: 'tx-1', name: 'Create Payment', topic: 'transLogV1' }),
    });
  });

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    await expect(
      registerKafkaCheck({ message_id: 'tx-1', name: 'x', topic: 'transLogV1' })
    ).rejects.toThrow();
  });
});

describe('fetchKafkaChecks', () => {
  it('returns the parsed list on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([{ message_id: 'tx-1' }]) }));
    expect(await fetchKafkaChecks()).toEqual([{ message_id: 'tx-1' }]);
  });

  it('returns an empty array when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve([]) }));
    expect(await fetchKafkaChecks()).toEqual([]);
  });

  it('returns an empty array when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchKafkaChecks()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/web test -- kafkaChecks.test.ts`
Expected: FAIL — cannot find module `../src/kafkaChecks` (and `sampleForm`'s `kafkaCheck` field doesn't exist on `FormState` yet, but TS errors don't block Vitest from reporting the missing-module failure first).

- [ ] **Step 3: Add the types**

In `packages/web/src/types.ts`, add after the `Protocol` type:

```ts
export type KafkaTopic = 'transLogV1' | 'refundLog' | 'paymentAuth';

export const KAFKA_TOPICS: KafkaTopic[] = ['transLogV1', 'refundLog', 'paymentAuth'];

export interface KafkaCheckFormState {
  enabled: boolean;
  topic: KafkaTopic;
}
```

and add `kafkaCheck: KafkaCheckFormState;` to the `FormState` interface, after `questions: QuestionRow[];`.

- [ ] **Step 4: Write the client module**

Create `packages/web/src/kafkaChecks.ts`:

```ts
import type { FormState, KafkaTopic } from './types';

const CORRELATOR_FIELDS: Record<KafkaTopic, string> = {
  transLogV1: 'appTransID',
  refundLog: 'appTransID',
  paymentAuth: 'order_no',
};

export function correlatorFieldFor(topic: KafkaTopic): string {
  return CORRELATOR_FIELDS[topic];
}

export function extractCorrelatorValue(form: FormState, topic: KafkaTopic): string | undefined {
  const raw = form.protocol === 'grpc' ? form.grpc.requestMessage : form.body;
  if (raw.trim() === '') {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const value = (parsed as Record<string, unknown>)[CORRELATOR_FIELDS[topic]];
  return value === undefined || value === null ? undefined : String(value);
}

export interface KafkaCheckRow {
  message_id: string;
  name: string;
  topic: string;
  status: 'pending' | 'received' | 'passed' | 'failed';
  missingFields: string[];
  matchedMessage: unknown;
  created_at: string;
  updated_at: string;
  retry_count: number;
}

export async function registerKafkaCheck(params: {
  message_id: string;
  name: string;
  topic: KafkaTopic;
}): Promise<void> {
  const response = await fetch('/kafka-checks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    throw new Error('Could not register the Kafka check.');
  }
}

export async function fetchKafkaChecks(): Promise<KafkaCheckRow[]> {
  try {
    const response = await fetch('/kafka-checks');
    if (!response.ok) {
      return [];
    }
    return (await response.json()) as KafkaCheckRow[];
  } catch {
    return [];
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/web test -- kafkaChecks.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: errors in every other file that constructs a `FormState` literal without `kafkaCheck` (`App.tsx`, and every test file with a `sampleForm`/`emptyForm`/`blankGrpc`-style helper). This is expected — Task 7 fixes `App.tsx` and the production call sites; leave test-helper fixes to whichever task modifies each file, since Tasks 7 and 8 already touch `RequestBuilder.test.tsx`, `RunButton.test.tsx`, `App.test.tsx`, and `Sidebar.test.tsx`. If typecheck must be clean before committing this task, also add `kafkaCheck: { enabled: false, topic: 'transLogV1' }` to every existing `FormState`-literal-producing test helper now: `ApiAutomationPage.test.tsx`'s `makeGrpcForm`/`makeRestForm`, `FlowRunner.test.tsx`'s `sampleForm`, `RequestBuilder.test.tsx`'s `baseProps`'s `grpc` (no — `RequestBuilder` doesn't take a whole `FormState`, skip), and any other `FormState` literal you find via `grep -rn "extracts: \[\]" packages/web/test packages/web/src`.

- [ ] **Step 7: Fix every other `FormState` literal so the workspace typechecks clean**

Run `grep -rln "extracts: \[\]" packages/web/src packages/web/test` to find every file constructing a full `FormState` object, and add `kafkaCheck: { enabled: false, topic: 'transLogV1' },` (or `kafkaCheck,` if the file already destructures overrides — follow each file's existing pattern for adding a new field, matching how `secure`/`skipCertVerification` were added in the TLS increment) to each one. At minimum this includes `App.tsx`'s `initialForm()`, `App.test.tsx`, `ApiAutomationPage.test.tsx`, `FlowRunner.test.tsx`, `RunButton.test.tsx`, and `steps.test.ts`.

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors

- [ ] **Step 8: Run the full web test suite**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS, no regressions

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/types.ts packages/web/src/kafkaChecks.ts packages/web/test/kafkaChecks.test.ts packages/web/src/App.tsx packages/web/test
git commit -m "feat(web): add KafkaTopic types and kafkaChecks client module"
```

---

### Task 7: "Check Kafka" checkbox in RequestBuilder + registration on Run

**Files:**
- Modify: `packages/web/src/components/RequestBuilder.tsx`
- Modify: `packages/web/src/components/SimpleModePage.tsx`
- Modify: `packages/web/src/components/RunButton.tsx`
- Test: `packages/web/test/components/RequestBuilder.test.tsx`
- Test: `packages/web/test/components/RunButton.test.tsx`

**Interfaces:**
- Consumes: `KAFKA_TOPICS`/`KafkaCheckFormState` (Task 6, `types.ts`), `correlatorFieldFor`/`extractCorrelatorValue`/`registerKafkaCheck` (Task 6, `kafkaChecks.ts`).
- Produces: `RequestBuilder` gains `kafkaCheck: KafkaCheckFormState` and `onKafkaCheckChange: (kafkaCheck: KafkaCheckFormState) => void` props. Nothing later in the plan consumes these directly — `App.tsx` (already wired to `FormState` generically) needs no further change beyond Task 6's `initialForm()` fix.

- [ ] **Step 1: Write the failing tests**

In `packages/web/test/components/RequestBuilder.test.tsx`, add `kafkaCheck: { enabled: false, topic: 'transLogV1' as const }` and `onKafkaCheckChange: vi.fn()` to the `baseProps()` helper's returned object (alongside the existing `extracts: []`/`onExtractsChange: vi.fn()` fields), then add these tests inside the `describe` block:

```tsx
  it('renders Check Kafka unchecked by default, with no Kafka Topic select', () => {
    render(<RequestBuilder {...baseProps()} />);
    expect(screen.getByLabelText('Check Kafka')).not.toBeChecked();
    expect(screen.queryByLabelText('Kafka Topic')).not.toBeInTheDocument();
  });

  it('shows the Kafka Topic select, defaulted correctly, when Check Kafka is checked', () => {
    render(
      <RequestBuilder
        {...baseProps({ kafkaCheck: { enabled: true, topic: 'refundLog' } })}
      />
    );
    expect(screen.getByLabelText('Kafka Topic')).toHaveValue('refundLog');
  });

  it('calls onKafkaCheckChange when the Check Kafka checkbox is toggled', async () => {
    const onKafkaCheckChange = vi.fn();
    render(<RequestBuilder {...baseProps({ onKafkaCheckChange })} />);
    await userEvent.click(screen.getByLabelText('Check Kafka'));
    expect(onKafkaCheckChange).toHaveBeenCalledWith({ enabled: true, topic: 'transLogV1' });
  });

  it('calls onKafkaCheckChange when the Kafka Topic select changes', async () => {
    const onKafkaCheckChange = vi.fn();
    render(
      <RequestBuilder
        {...baseProps({ kafkaCheck: { enabled: true, topic: 'transLogV1' }, onKafkaCheckChange })}
      />
    );
    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'paymentAuth');
    expect(onKafkaCheckChange).toHaveBeenCalledWith({ enabled: true, topic: 'paymentAuth' });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- RequestBuilder.test.tsx`
Expected: FAIL — no element found for label "Check Kafka".

- [ ] **Step 3: Add the checkbox and select to `RequestBuilder`**

In `packages/web/src/components/RequestBuilder.tsx`, add to the imports:

```tsx
import { KAFKA_TOPICS, type AuthConfig, type ExtractRow, type GrpcFormState, type KafkaCheckFormState, type KeyValueRow, type Protocol, type QuestionRow } from '../types';
```

(replacing the existing `import type { AuthConfig, ExtractRow, GrpcFormState, KeyValueRow, Protocol, QuestionRow } from '../types';` line — `KAFKA_TOPICS` is a value export so it needs its own non-`type` import specifier alongside the type-only ones, hence the combined line above.)

Add to `RequestBuilderProps`, after `onQuestionsChange: (rows: QuestionRow[]) => void;`:

```tsx
  kafkaCheck: KafkaCheckFormState;
  onKafkaCheckChange: (kafkaCheck: KafkaCheckFormState) => void;
```

Destructure `kafkaCheck, onKafkaCheckChange` in the function body's prop list (after `onQuestionsChange`).

Add a new row right after the closing `</div>` of the first `<div className="row">` (the one containing Protocol and Method/URL or Server Address/Secure), before the `{protocol === 'rest' ? (` block:

```tsx
      <div className="row">
        <label className="label">
          Check Kafka
          <input
            type="checkbox"
            checked={kafkaCheck.enabled}
            onChange={(e) => onKafkaCheckChange({ ...kafkaCheck, enabled: e.target.checked })}
          />
        </label>
        {kafkaCheck.enabled && (
          <label className="label">
            Kafka Topic
            <select
              className="text-input"
              value={kafkaCheck.topic}
              onChange={(e) => onKafkaCheckChange({ ...kafkaCheck, topic: e.target.value as KafkaCheckFormState['topic'] })}
            >
              {KAFKA_TOPICS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- RequestBuilder.test.tsx`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Wire `kafkaCheck` through `SimpleModePage`**

In `packages/web/src/components/SimpleModePage.tsx`, add to the `<RequestBuilder>` element's props, after `onQuestionsChange={...}`:

```tsx
        kafkaCheck={form.kafkaCheck}
        onKafkaCheckChange={(kafkaCheck) => onFormChange((prev) => ({ ...prev, kafkaCheck }))}
```

- [ ] **Step 6: Write the failing `RunButton` tests**

In `packages/web/test/components/RunButton.test.tsx`, add `kafkaCheck: { enabled: false, topic: 'transLogV1' as const }` to the `emptyForm()` helper's returned object, then add these tests inside the `describe` block:

```tsx
  it('registers a Kafka check alongside the run when Check Kafka is enabled', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/kafka-checks') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const form = {
      ...emptyForm(),
      body: '{"appTransID":"tx-123"}',
      kafkaCheck: { enabled: true, topic: 'transLogV1' as const },
    };
    render(<RunButton form={form} disabled={false} onRunStart={() => {}} onEvent={() => {}} onError={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(fetchMock).toHaveBeenCalledWith('/kafka-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: 'tx-123', name: 'Task', topic: 'transLogV1' }),
    });
  });

  it('calls onError and skips registration when the correlator field is missing from the body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) }));
    const onError = vi.fn();
    const form = {
      ...emptyForm(),
      body: '{"other":1}',
      kafkaCheck: { enabled: true, topic: 'transLogV1' as const },
    };
    render(<RunButton form={form} disabled={false} onRunStart={() => {}} onEvent={() => {}} onError={onError} />);

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('appTransID'));
  });

  it('does not register a Kafka check when Check Kafka is disabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<RunButton form={emptyForm()} disabled={false} onRunStart={() => {}} onEvent={() => {}} onError={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(fetchMock).not.toHaveBeenCalledWith('/kafka-checks', expect.anything());
  });
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- RunButton.test.tsx`
Expected: FAIL — no `/kafka-checks` call is ever made.

- [ ] **Step 8: Add the registration call to `RunButton`**

Replace the full contents of `packages/web/src/components/RunButton.tsx` with:

```tsx
import type { RunEvent } from '@ai-native-testing/engine';
import { buildTestDefinition } from '../dsl';
import { correlatorFieldFor, extractCorrelatorValue, registerKafkaCheck } from '../kafkaChecks';
import type { FormState } from '../types';

interface RunButtonProps {
  form: FormState;
  disabled: boolean;
  onRunStart: () => void;
  onEvent: (event: RunEvent) => void;
  onError: (message: string) => void;
}

export function RunButton({ form, disabled, onRunStart, onEvent, onError }: RunButtonProps) {
  async function handleClick() {
    onRunStart();

    if (form.kafkaCheck.enabled) {
      const correlatorValue = extractCorrelatorValue(form, form.kafkaCheck.topic);
      if (correlatorValue === undefined) {
        onError(
          `Check Kafka: could not find "${correlatorFieldFor(form.kafkaCheck.topic)}" in the request body.`
        );
      } else {
        registerKafkaCheck({
          message_id: correlatorValue,
          name: form.taskName,
          topic: form.kafkaCheck.topic,
        }).catch(() => {
          onError('Check Kafka: could not register the tracking check.');
        });
      }
    }

    let definition;
    try {
      definition = buildTestDefinition(form);
    } catch (err) {
      onError(`Invalid request: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    let jobId: string;
    try {
      const response = await fetch('/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(definition),
      });
      if (!response.ok) {
        const body = await response.json();
        onError(`Could not start run: ${JSON.stringify(body)}`);
        return;
      }
      const body = (await response.json()) as { jobId: string };
      jobId = body.jobId;
    } catch (err) {
      onError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const source = new EventSource(`/runs/${jobId}/events`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as RunEvent;
      onEvent(event);
      if (event.type === 'run:completed' || event.type === 'run:failed') {
        source.close();
      }
    };
    source.onerror = () => {
      onError('Connection lost — partial results shown below.');
      source.close();
    };
  }

  return (
    <button type="button" className="btn-primary" onClick={handleClick} disabled={disabled}>
      Run
    </button>
  );
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- RunButton.test.tsx`
Expected: PASS (all tests in the file)

- [ ] **Step 10: Run the full web test suite and typecheck**

Run: `pnpm --filter @ai-native-testing/web test`
Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: PASS / no errors

- [ ] **Step 11: Commit**

```bash
git add packages/web/src/components/RequestBuilder.tsx packages/web/src/components/SimpleModePage.tsx packages/web/src/components/RunButton.tsx packages/web/test/components/RequestBuilder.test.tsx packages/web/test/components/RunButton.test.tsx
git commit -m "feat(web): add Check Kafka checkbox and registration on Run"
```

---

### Task 8: "Check Kafka" page, Sidebar entry, and route wiring

**Files:**
- Create: `packages/web/src/components/KafkaChecksPage.tsx`
- Test: `packages/web/test/components/KafkaChecksPage.test.tsx`
- Modify: `packages/web/src/components/Sidebar.tsx`
- Test: `packages/web/test/components/Sidebar.test.tsx`
- Modify: `packages/web/src/App.tsx`
- Test: `packages/web/test/App.test.tsx`

**Interfaces:**
- Consumes: `fetchKafkaChecks`/`KafkaCheckRow` (Task 6).
- Produces: `KafkaChecksPage` component (no props). Final task — nothing later depends on it.

- [ ] **Step 1: Write the failing test for `KafkaChecksPage`**

Create `packages/web/test/components/KafkaChecksPage.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KafkaChecksPage } from '../../src/components/KafkaChecksPage';
import type { KafkaCheckRow } from '../../src/kafkaChecks';

function makeRow(overrides: Partial<KafkaCheckRow> = {}): KafkaCheckRow {
  return {
    message_id: 'tx-1',
    name: 'Create Payment',
    topic: 'transLogV1',
    status: 'passed',
    missingFields: [],
    matchedMessage: { data: { transID: 1 } },
    created_at: '2026-08-05T00:00:00.000Z',
    updated_at: '2026-08-05T00:00:01.000Z',
    retry_count: 0,
    ...overrides,
  };
}

describe('KafkaChecksPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists fetched rows with name, topic, and status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([makeRow()]) }));
    render(<KafkaChecksPage />);
    const row = await screen.findByRole('button', { name: /Create Payment/ });
    expect(row).toHaveTextContent('transLogV1');
    expect(row).toHaveTextContent('passed');
  });

  it('expands a row to show the matched message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([makeRow()]) }));
    render(<KafkaChecksPage />);
    const row = await screen.findByRole('button', { name: /Create Payment/ });
    await userEvent.click(row);
    expect(await screen.findByText(/"transID": 1/)).toBeInTheDocument();
  });

  it('shows missing fields instead of the message when the check failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([makeRow({ status: 'failed', missingFields: ['mcc'] })]),
      })
    );
    render(<KafkaChecksPage />);
    const row = await screen.findByRole('button', { name: /Create Payment/ });
    await userEvent.click(row);
    expect(await screen.findByText('Missing fields: mcc')).toBeInTheDocument();
  });

  it('shows an empty state when there are no checks yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    render(<KafkaChecksPage />);
    expect(await screen.findByText('No Kafka checks yet.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/web test -- KafkaChecksPage.test.tsx`
Expected: FAIL — cannot find module `../../src/components/KafkaChecksPage`.

- [ ] **Step 3: Write the page**

Create `packages/web/src/components/KafkaChecksPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { fetchKafkaChecks, type KafkaCheckRow } from '../kafkaChecks';

const POLL_INTERVAL_MS = 3000;

export function KafkaChecksPage() {
  const [rows, setRows] = useState<KafkaCheckRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetchKafkaChecks().then(setRows);
    const id = setInterval(() => {
      fetchKafkaChecks().then(setRows);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="app-main">
      <h1 className="heading-xl">Check Kafka</h1>
      {rows.length === 0 && <p className="body-strong">No Kafka checks yet.</p>}
      <ul className="step-browser-list">
        {rows.map((row) => (
          <li key={row.message_id}>
            <button
              type="button"
              className="step-browser-row"
              onClick={() => setExpanded(expanded === row.message_id ? null : row.message_id)}
            >
              <span className="step-browser-name">{row.name}</span>
              <span className="step-browser-meta">{row.topic}</span>
              <span className="step-browser-flows">{row.status}</span>
            </button>
            {expanded === row.message_id && (
              <pre className="code-block">
                {row.missingFields.length > 0
                  ? `Missing fields: ${row.missingFields.join(', ')}`
                  : JSON.stringify(row.matchedMessage, null, 2)}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/web test -- KafkaChecksPage.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing Sidebar test**

Replace the full contents of `packages/web/test/components/Sidebar.test.tsx` with:

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
  it('renders all four nav items with the correct hrefs', () => {
    renderSidebar('/');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).toHaveAttribute('href', '/e2e-test');
    expect(screen.getByRole('link', { name: 'API Automation' })).toHaveAttribute('href', '/api-automation');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).toHaveAttribute('href', '/kafka-checks');
  });

  it('marks Simple Mode active on the root path', () => {
    renderSidebar('/');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'API Automation' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).not.toHaveAttribute('aria-current');
  });

  it('marks End-to-end test active on /e2e-test, not the others', () => {
    renderSidebar('/e2e-test');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'API Automation' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).not.toHaveAttribute('aria-current');
  });

  it('marks API Automation active on /api-automation, not the others', () => {
    renderSidebar('/api-automation');
    expect(screen.getByRole('link', { name: 'API Automation' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).not.toHaveAttribute('aria-current');
  });

  it('marks Check Kafka active on /kafka-checks, not the others', () => {
    renderSidebar('/kafka-checks');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'API Automation' })).not.toHaveAttribute('aria-current');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @ai-native-testing/web test -- Sidebar.test.tsx`
Expected: FAIL — no link named "Check Kafka".

- [ ] **Step 7: Add the nav entry**

In `packages/web/src/components/Sidebar.tsx`, add a fourth `NavLink` after the "API Automation" one:

```tsx
      <NavLink
        to="/kafka-checks"
        className={({ isActive }) => (isActive ? 'sidebar-link sidebar-link--active' : 'sidebar-link')}
      >
        Check Kafka
      </NavLink>
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @ai-native-testing/web test -- Sidebar.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 9: Write the failing `App.test.tsx` tests**

In `packages/web/test/App.test.tsx`, extend the `stubNameListFetch` helper's URL check to also stub `/kafka-checks` for GET (list) requests:

```tsx
function stubNameListFetch(runsResponse: unknown = { ok: false, json: () => Promise.resolve({}) }) {
  return vi.fn((url: string) => {
    if (url === '/actors' || url === '/tasks' || url === '/steps' || url === '/flows' || url === '/kafka-checks') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    return Promise.resolve(runsResponse);
  });
}
```

Then add these tests at the end of the `describe('App', ...)` block:

```tsx
  it('switches to Check Kafka via the sidebar', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('link', { name: 'Check Kafka' }));
    expect(screen.getByRole('heading', { name: 'Check Kafka' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Simple Mode' })).not.toBeInTheDocument();
  });

  it('registers a Kafka check when Check Kafka is enabled and Run is clicked', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/actors' || url === '/tasks' || url === '/steps' || url === '/flows' || url === '/kafka-checks') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobId: 'job-1' }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await userEvent.type(screen.getByLabelText('Task'), 'Create Payment');
    await userEvent.type(screen.getByLabelText('URL'), 'https://api.example.com/v1/payments');
    await userEvent.click(screen.getByRole('button', { name: 'Body' }));
    // '{{}' is user-event's escape for a literal '{' — a bare '{' starts a
    // special-key sequence like '{enter}' in its typing DSL.
    await userEvent.type(screen.getByLabelText('Body (JSON)'), '{{}"appTransID":"tx-999"}');
    await userEvent.click(screen.getByLabelText('Check Kafka'));

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(fetchMock).toHaveBeenCalledWith('/kafka-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: 'tx-999', name: 'Create Payment', topic: 'transLogV1' }),
    });
  });
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- App.test.tsx`
Expected: FAIL — no link/heading named "Check Kafka".

- [ ] **Step 11: Add the route**

In `packages/web/src/App.tsx`, add the import:

```tsx
import { KafkaChecksPage } from './components/KafkaChecksPage';
```

and, inside `<Routes>`, immediately after the `/api-automation` route:

```tsx
          <Route path="/kafka-checks" element={<KafkaChecksPage />} />
```

- [ ] **Step 12: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- App.test.tsx`
Expected: PASS (all tests in the file)

- [ ] **Step 13: Run the full web test suite and typecheck**

Run: `pnpm --filter @ai-native-testing/web test`
Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: PASS / no errors

- [ ] **Step 14: Commit**

```bash
git add packages/web/src/components/KafkaChecksPage.tsx packages/web/test/components/KafkaChecksPage.test.tsx packages/web/src/components/Sidebar.tsx packages/web/test/components/Sidebar.test.tsx packages/web/src/App.tsx packages/web/test/App.test.tsx
git commit -m "feat(web): add Check Kafka page, nav entry, and route"
```

---

## Final Verification

1. Run `pnpm test` and `pnpm typecheck` from the repo root — confirm zero failures across all packages.
2. Manual verification is limited by the two documented risks (message-shape uncertainty, no network access to the real internal brokers from this environment):
   - Confirm the server boots cleanly with **no** `packages/server/config/kafka.yaml` present (the common case in this environment) — it should log a warning and continue serving every other route normally.
   - In the browser: check "Check Kafka," confirm the Kafka Topic select appears with the three options, fill a request body containing `appTransID` (or `order_no` for paymentAuth), click Run, and confirm a row appears on the "Check Kafka" page as PENDING (no real broker needed to observe registration — only the consumer-side matching requires one).
   - If you have real access to the brokers in your own environment: point `packages/server/config/kafka.yaml` at them, restart the server, and confirm a real transaction's row transitions to PASSED/FAILED with the correct missing-fields detail — this is the step that may need message-parsing adjustments per the documented risk.
3. Clean up any test data written to `packages/server/data/*.json` afterward, per this session's established convention.
