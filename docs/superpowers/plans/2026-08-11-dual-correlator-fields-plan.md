# Dual Correlator Fields for Kafka Check Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `transLogV1` and `refundLog` Kafka checks resolve whether they were registered under `appTransID` or `transID` — today only `appTransID` matches, so a check registered under a real `transID` value times out even when the message exists.

**Architecture:** `KafkaTopicDefinition.correlatorField: string` becomes `correlatorFields: string[]`; `extractCorrelatorValue` becomes `extractCorrelatorValues` (returns every candidate value present in the message); `handleIncomingMessage` tries each candidate in turn, resolving the first pending row it finds. Backend-only — no frontend changes.

**Tech Stack:** TypeScript (`packages/server`), Vitest.

## Global Constraints

- `paymentAuth` keeps its exact current behavior (`correlatorFields: ['order_no']`, a single-element array) — not extended with `trans_id`, per the approved spec's explicit scope.
- The Run-triggered auto-registration path (`packages/web/src/kafkaChecks.ts`) is untouched — it has its own separate, single-field `CORRELATOR_FIELDS` map and continues to register under `appTransID` only, since `transID` isn't known before a request is sent. Do not touch any file under `packages/web` for this plan.
- Field-check order matters for determinism but not correctness: `appTransID` is checked before `transID` for `transLogV1`/`refundLog`, matching the array order below.
- TDD: write the failing tests, run them, confirm the failure, implement, run again, confirm the pass, typecheck, commit.

---

### Task 1: Dual correlator field matching

**Files:**
- Modify: `packages/server/src/kafka-check-definitions.ts`
- Modify: `packages/server/src/kafka-check-logic.ts`
- Modify: `packages/server/src/kafka-consumer.ts`
- Test: `packages/server/test/kafka-check-logic.test.ts`
- Test: `packages/server/test/kafka-consumer.test.ts`

**Interfaces:**
- Produces: `export interface KafkaTopicDefinition { correlatorFields: string[]; hasDataWrapper: boolean; requiredFields: string[] }` (replaces the singular `correlatorField: string`), `export function extractCorrelatorValues(message: unknown, topic: KafkaTopicKey): string[]` (replaces `extractCorrelatorValue`, which returned `string | undefined`).

- [ ] **Step 1: Write the failing tests**

Replace the `describe('extractCorrelatorValue', ...)` block in `packages/server/test/kafka-check-logic.test.ts` with:

```ts
describe('extractCorrelatorValues', () => {
  it('reads both candidate correlator fields out of the data wrapper for transLogV1, in field order', () => {
    expect(extractCorrelatorValues(TRANS_LOG_MESSAGE, 'transLogV1')).toEqual(['tx-abc', '1']);
  });

  it('reads the sole correlator field at the top level for paymentAuth', () => {
    expect(extractCorrelatorValues(PAYMENT_AUTH_MESSAGE, 'paymentAuth')).toEqual(['order-1']);
  });

  it('returns only the fields actually present when one candidate is missing', () => {
    expect(extractCorrelatorValues({ data: { transID: 1 } }, 'transLogV1')).toEqual(['1']);
    expect(extractCorrelatorValues({ data: { appTransID: 'tx-abc' } }, 'transLogV1')).toEqual(['tx-abc']);
  });

  it('returns an empty array when no candidate fields are present', () => {
    expect(extractCorrelatorValues({ data: {} }, 'transLogV1')).toEqual([]);
  });

  it('returns an empty array when the data wrapper is missing', () => {
    expect(extractCorrelatorValues({}, 'transLogV1')).toEqual([]);
  });

  it('returns an empty array for a non-object message', () => {
    expect(extractCorrelatorValues('not json', 'transLogV1')).toEqual([]);
  });

  it('stringifies numeric correlator values', () => {
    expect(extractCorrelatorValues({ data: { appTransID: 12345, transID: 67890 } }, 'transLogV1')).toEqual([
      '12345',
      '67890',
    ]);
  });
});
```

Also update the import line at the top of the file from `import { extractCorrelatorValue, checkRequiredFields, isTimedOut } from '../src/kafka-check-logic.js';` to `import { extractCorrelatorValues, checkRequiredFields, isTimedOut } from '../src/kafka-check-logic.js';`.

Append to `packages/server/test/kafka-consumer.test.ts`'s existing `describe('handleIncomingMessage', ...)` block (do not create a new `describe`):

```ts
  it('resolves a pending row registered under transID when appTransID does not match any pending row', async () => {
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
    message.data.appTransID = 'some-other-app-trans-id-not-registered';
    message.data.transID = 'tx-1';

    await handleIncomingMessage('transLogV1', JSON.stringify(message), store);

    const row = await store.get('tx-1');
    expect(row?.status).toBe('passed');
    expect(row?.matchedMessage).toEqual(message);
  });

  it('ignores a message when neither candidate field matches any pending row', async () => {
    await store.create(pendingRow());
    const message = { data: { appTransID: 'unknown-app-trans-id', transID: 'unknown-trans-id' } };
    await handleIncomingMessage('transLogV1', JSON.stringify(message), store);
    expect((await store.get('tx-1'))?.status).toBe('pending');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test -- kafka-check-logic.test.ts kafka-consumer.test.ts`
Expected: FAIL — `extractCorrelatorValues` is not exported yet (`kafka-check-logic.test.ts`), and the two new `handleIncomingMessage` cases fail since matching still only checks `appTransID` (`kafka-consumer.test.ts`).

- [ ] **Step 3: Implement dual-field matching**

Replace `packages/server/src/kafka-check-definitions.ts` in full:

```ts
export type KafkaTopicKey = 'transLogV1' | 'refundLog' | 'paymentAuth';

export const KAFKA_TOPIC_KEYS: KafkaTopicKey[] = ['transLogV1', 'refundLog', 'paymentAuth'];

export interface KafkaTopicDefinition {
  correlatorFields: string[];
  hasDataWrapper: boolean;
  requiredFields: string[];
}

export const KAFKA_TOPIC_DEFINITIONS: Record<KafkaTopicKey, KafkaTopicDefinition> = {
  transLogV1: {
    correlatorFields: ['appTransID', 'transID'],
    hasDataWrapper: true,
    requiredFields: [
      'transID', 'appID', 'transType', 'pmcID', 'amount', 'userChargeAmount', 'userFeeAmount',
      'transStatus', 'status', 'userID', 'appTransID', 'isFullFlow', 'authInfo', 'merchantCategoryCode',
      'productType', 'orderNo', 'paymentNo', 'paymentMethod', 'destTxnStatus', 'sourceTxnStatus',
      'destAssetType', 'destAssetData', 'sourceAssetData',
    ],
  },
  refundLog: {
    correlatorFields: ['appTransID', 'transID'],
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
    correlatorFields: ['order_no'],
    hasDataWrapper: false,
    requiredFields: [
      'payment_no', 'order_no', 'auth_session_id', 'auth_data', 'trans_id', 'fund_type', 'detail_reason',
      'transaction',
    ],
  },
};
```

Replace `packages/server/src/kafka-check-logic.ts` in full:

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

export function extractCorrelatorValues(message: unknown, topic: KafkaTopicKey): string[] {
  const payload = payloadOf(message, topic);
  if (!payload) {
    return [];
  }
  const values: string[] = [];
  for (const field of KAFKA_TOPIC_DEFINITIONS[topic].correlatorFields) {
    const value = payload[field];
    if (value !== undefined && value !== null) {
      values.push(String(value));
    }
  }
  return values;
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

In `packages/server/src/kafka-consumer.ts`:
1. Update the import: `import { extractCorrelatorValues, checkRequiredFields, isTimedOut } from './kafka-check-logic.js';`
2. Replace `handleIncomingMessage`'s body:

```ts
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

  const candidateValues = extractCorrelatorValues(parsed, topic);
  for (const correlatorValue of candidateValues) {
    const row = await store.get(correlatorValue);
    if (!row || row.topic !== topic || row.status !== 'pending') {
      continue;
    }

    await store.update(correlatorValue, { status: 'received' });
    const missingFields = checkRequiredFields(parsed, topic);
    await store.update(correlatorValue, {
      status: missingFields.length === 0 ? 'passed' : 'failed',
      missingFields,
      matchedMessage: parsed,
    });
    return;
  }
}
```

(Only `handleIncomingMessage` changes — `sweepTimedOutChecks`, `startConsumerForTopic`, and `startKafkaConsumers` are untouched.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test -- kafka-check-logic.test.ts kafka-consumer.test.ts`
Expected: PASS (all tests, including every pre-existing one — in particular, confirm `handleIncomingMessage`'s pre-existing `'marks a matching pending row passed when every required field is present'` test still passes, since it's the regression proof that `appTransID`-based matching is unaffected).

- [ ] **Step 5: Full workspace verification**

Run, from the repo root:
```bash
pnpm test
pnpm typecheck
```
Expected: all packages green, zero typecheck errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/kafka-check-definitions.ts packages/server/src/kafka-check-logic.ts packages/server/src/kafka-consumer.ts packages/server/test/kafka-check-logic.test.ts packages/server/test/kafka-consumer.test.ts
git commit -m "feat(server): match Kafka checks on transID as well as appTransID for transLogV1/refundLog"
```

- [ ] **Step 7: Manual verification**

Using the real broker/config already set up for the Manual Kafka Check increment: register a check with the real `transID` value from a transaction already visible in the app's logs (the same scenario that motivated this fix), and confirm it now resolves to PASSED/FAILED instead of timing out — matching the real message this time via the `transID` field. Clean up any disposable test entries from `packages/server/data/kafka-checks.json` afterward, leaving the developer's real entries untouched.
