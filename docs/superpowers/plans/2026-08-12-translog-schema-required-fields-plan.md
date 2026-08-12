# TransLogV1 Required Fields from Schema File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `transLogV1`'s hardcoded, status-agnostic required-fields list with one computed from the user-authored `packages/server/config/translog_required_fields_schema.json` (`common_fields` always required, plus per-`status` additions from `schemas_by_status`).

**Architecture:** New module `translog-required-fields.ts` loads the JSON file once at import time and exposes `getTransLogRequiredFields(status)`. `kafka-check-logic.ts`'s `checkRequiredFields` uses it for `transLogV1` only; `refundLog`/`paymentAuth` are untouched.

**Tech Stack:** TypeScript (`packages/server`), Vitest.

## Global Constraints

- Confirmed via `node -e` inspection of the real file: `common_fields.required_fields` has 133 entries; `schemas_by_status.SUCCESS.required_fields` (16 entries) is already a full subset of `common_fields` — so for `status: 'SUCCESS'` the union equals the common list today. Do not hardcode either count in a test in a way that breaks if the JSON's field lists change size — use `getTransLogRequiredFields(undefined)` as the live reference instead of a magic number.
- The file's `schemas_by_status.PROCESSING` block is known to be incorrect (mismatched field-naming convention vs. real messages) — this is the user's responsibility to fix in the JSON, not something this plan works around in code. The code must stay fully data-driven: whatever `schemas_by_status` contains is what gets checked, no hardcoded status names.
- `translog_required_fields_schema.json` gets committed to the repo as part of this task's commit (it is currently untracked and not covered by `.gitignore`, unlike `kafka.yaml`).
- TDD: write the failing tests, run them, confirm the failure, implement, run again, confirm the pass, typecheck, commit.

---

### Task 1: Schema-driven transLogV1 required fields

**Files:**
- Create: `packages/server/src/translog-required-fields.ts`
- Modify: `packages/server/src/kafka-check-definitions.ts`
- Modify: `packages/server/src/kafka-check-logic.ts`
- Create: `packages/server/test/translog-required-fields.test.ts`
- Modify: `packages/server/test/kafka-check-logic.test.ts`
- Untracked file to commit: `packages/server/config/translog_required_fields_schema.json`

**Interfaces:**
- Produces: `export function getTransLogRequiredFields(status: string | undefined): string[]` — the deduplicated union of `common_fields.required_fields` and `schemas_by_status[status]?.required_fields` (empty if `status` is `undefined` or doesn't match any key).

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/translog-required-fields.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getTransLogRequiredFields } from '../src/translog-required-fields.js';

describe('getTransLogRequiredFields', () => {
  it('returns the common fields alone when status is undefined', () => {
    const fields = getTransLogRequiredFields(undefined);
    expect(fields.length).toBeGreaterThan(0);
    expect(fields).toContain('appTransID');
  });

  it('returns the common fields alone when status does not match any known schema', () => {
    expect(getTransLogRequiredFields('SOME_UNKNOWN_STATUS')).toEqual(getTransLogRequiredFields(undefined));
  });

  it('returns a deduplicated union when status matches a known schema', () => {
    const fields = getTransLogRequiredFields('SUCCESS');
    expect(new Set(fields).size).toBe(fields.length);
    expect(fields).toEqual(expect.arrayContaining(getTransLogRequiredFields(undefined)));
  });
});
```

Replace the `describe('checkRequiredFields', ...)` block in `packages/server/test/kafka-check-logic.test.ts` with:

```ts
describe('checkRequiredFields', () => {
  it('returns an empty array for transLogV1 when every common field is present', () => {
    const commonFields = getTransLogRequiredFields(undefined);
    const message = { data: Object.fromEntries(commonFields.map((field) => [field, 'x'])) };
    expect(checkRequiredFields(message, 'transLogV1')).toEqual([]);
  });

  it('lists every missing field for transLogV1', () => {
    expect(checkRequiredFields({ data: { transID: 1 } }, 'transLogV1')).toEqual(
      expect.arrayContaining(['appID', 'appTransID', 'status'])
    );
    expect(checkRequiredFields({ data: { transID: 1 } }, 'transLogV1')).not.toContain('transID');
  });

  it('includes status-specific fields on top of common fields when the message status matches a known schema', () => {
    const commonFields = getTransLogRequiredFields(undefined);
    const successFields = getTransLogRequiredFields('SUCCESS');
    expect(successFields).toEqual(expect.arrayContaining(commonFields));
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

  it('returns the full common-fields list for transLogV1 when the message has no usable payload', () => {
    expect(checkRequiredFields({}, 'transLogV1')).toEqual(getTransLogRequiredFields(undefined));
  });
});
```

Add `import { getTransLogRequiredFields } from '../src/translog-required-fields.js';` to the top of `packages/server/test/kafka-check-logic.test.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test -- translog-required-fields.test.ts kafka-check-logic.test.ts`
Expected: FAIL — `translog-required-fields.js` doesn't exist yet, and `checkRequiredFields` for `transLogV1` still uses the old 23-field hardcoded list.

- [ ] **Step 3: Implement the schema-driven required fields**

Create `packages/server/src/translog-required-fields.ts`:

```ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface TransLogSchema {
  common_fields: { required_fields: string[] };
  schemas_by_status: Record<string, { required_fields: string[] }>;
}

const SCHEMA_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'config',
  'translog_required_fields_schema.json'
);

const SCHEMA: TransLogSchema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

export function getTransLogRequiredFields(status: string | undefined): string[] {
  const statusFields = (status !== undefined ? SCHEMA.schemas_by_status[status]?.required_fields : undefined) ?? [];
  return [...new Set([...SCHEMA.common_fields.required_fields, ...statusFields])];
}
```

In `packages/server/src/kafka-check-definitions.ts`:
1. Change the interface field from `requiredFields: string[];` to `requiredFields?: string[];`.
2. Remove the `requiredFields: [...]` array entirely from the `transLogV1` entry (leaving `correlatorFields` and `hasDataWrapper` there, unchanged). `refundLog` and `paymentAuth` keep their `requiredFields` arrays exactly as-is.

Replace `packages/server/src/kafka-check-logic.ts`'s `checkRequiredFields` function:

```ts
import { getTransLogRequiredFields } from './translog-required-fields.js';

// ... (payloadOf and extractCorrelatorValues unchanged) ...

export function checkRequiredFields(message: unknown, topic: KafkaTopicKey): string[] {
  const payload = payloadOf(message, topic);
  const status = payload !== undefined && typeof payload.status === 'string' ? payload.status : undefined;
  const requiredFields =
    topic === 'transLogV1' ? getTransLogRequiredFields(status) : (KAFKA_TOPIC_DEFINITIONS[topic].requiredFields ?? []);
  if (!payload) {
    return [...requiredFields];
  }
  return requiredFields.filter((field) => !(field in payload));
}
```

(Add the `import { getTransLogRequiredFields } from './translog-required-fields.js';` line near the top, alongside the existing `KAFKA_TOPIC_DEFINITIONS` import. `payloadOf` and `extractCorrelatorValues` are unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test -- translog-required-fields.test.ts kafka-check-logic.test.ts`
Expected: PASS (all tests, including every pre-existing one in `kafka-check-logic.test.ts` not touched above — `extractCorrelatorValues` and `isTimedOut` blocks).

- [ ] **Step 5: Fix the two now-broken fixtures in kafka-consumer.test.ts**

`packages/server/test/kafka-consumer.test.ts` has two message fixtures that hand-list the old 23 fields (confirmed by inspection, not speculative — both will fail once `checkRequiredFields` checks against the real 133-field common list instead):

1. `'marks a matching pending row passed when every required field is present'` (currently around line 47-67)
2. `'resolves a pending row registered under transID when appTransID does not match any pending row'` (currently around line 85-104)

Add `import { getTransLogRequiredFields } from '../src/translog-required-fields.js';` to the top of the file, then replace each fixture's field list. For fixture 1, replace:

```ts
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
```

with:

```ts
    const message = {
      data: Object.fromEntries(getTransLogRequiredFields(undefined).map((field) => [field, 'x'])),
    };
    message.data.appTransID = 'tx-1';
```

For fixture 2, replace the identical `Object.fromEntries([...23 fields...])` block with the same one-line `Object.fromEntries(getTransLogRequiredFields(undefined).map((field) => [field, 'x']))`, keeping its subsequent `message.data.appTransID = 'some-other-app-trans-id-not-registered';` and `message.data.transID = 'tx-1';` lines unchanged.

- [ ] **Step 6: Run the full server test suite and workspace verification**

Run:
```bash
pnpm --filter @ai-native-testing/server test
pnpm test
pnpm typecheck
```
Expected: all packages green, zero typecheck errors — including both fixed `kafka-consumer.test.ts` fixtures now passing again.

- [ ] **Step 7: Commit**

```bash
git add packages/server/config/translog_required_fields_schema.json packages/server/src/translog-required-fields.ts packages/server/src/kafka-check-definitions.ts packages/server/src/kafka-check-logic.ts packages/server/test/translog-required-fields.test.ts packages/server/test/kafka-check-logic.test.ts packages/server/test/kafka-consumer.test.ts
git commit -m "feat(server): drive transLogV1 required-fields checking from translog_required_fields_schema.json"
```

- [ ] **Step 8: Manual verification**

Feed a real `transLogV1` `SUCCESS`-status message (e.g. the one already used for the dual-correlator-fields verification) through `handleIncomingMessage` against an isolated temp store, and confirm the missing-fields list now reflects the real 133-field common list rather than the old 23-field list — a real message that previously showed 0 missing fields might now show some, if it's missing fields from the newly-added ones; this is expected and correct (the whole point of using the richer schema), not a regression. Report to the user what shows as missing, if anything, so they can judge whether the real integration actually sends those fields.
