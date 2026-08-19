# Kafka Diff Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure comparison function that diffs a captured Kafka baseline's messages against a new set of actual messages for the same topic, reporting differences with severity, plus a small CLI to run it manually against two baseline files.

**Architecture:** `diffKafkaMessages` (`packages/server/src/kafka-diff-engine.ts`) is a pure function with zero I/O, reusing the existing `KAFKA_TOPIC_DEFINITIONS` and a newly-exported `payloadOf` helper from `kafka-check-logic.ts`. It groups each side's messages by `status`, pairs matching statuses, and diffs their fields (minus an ignore-list). A CLI script (`packages/web/scripts/compare-baselines.ts`) reads two baseline JSON files from disk and prints the report.

**Tech Stack:** TypeScript, Vitest (unit tests), `node:util`'s `parseArgs` (existing CLI convention from `capture-baseline.ts`), no new dependencies.

## Global Constraints

- `diffKafkaMessages(baselineMessages: unknown[], actualMessages: unknown[], topic: KafkaTopicKey): DiffReport` lives in `packages/server/src/kafka-diff-engine.ts` and has zero I/O (no fetch, no fs, no Kafka).
- Reuse `payloadOf` from `kafka-check-logic.ts` (exported, not duplicated) for wrapper-unwrapping — do not write a second unwrapping implementation.
- Messages are paired across baseline/actual by their `status` field (hardcoded field name `'status'`, matching the existing convention in `baseline-capture-core.ts`/`collectKafkaMessages`).
- If a status appears more than once on either side, only the first occurrence (array order) is used for comparison.
- Field comparison is top-level-keys-only — a nested object/array field that differs anywhere inside it produces exactly one `changed-field` finding for that key, never a per-nested-path finding.
- Ignore list for field comparison = a global case-insensitive suffix rule (`endsWith('time')` or `endsWith('date')`) **plus** `KafkaTopicDefinition.diffIgnoreFields` (new optional field, defaulting to that topic's `correlatorFields` when unset).
- Severity is fixed per finding kind, never overridable: `missing-message` = critical, `missing-field` = critical, `changed-field` = warning, `extra-message` = info, `extra-field` = info.
- `DiffReport.result` is `'failed'` iff at least one finding has severity `'critical'`; otherwise `'passed'`.
- CLI script `packages/web/scripts/compare-baselines.ts` takes `--baseline <path> --actual <path> --topic <transLogV1|refundLog|paymentAuth>`, both files in the baseline JSON shape (`{ capturedAt, version, status, durationMs, messages }`), and exits 0 on `passed` / 1 on `failed`.
- No automated test for the CLI script itself — matches the established pattern from `capture-baseline.ts`/`update-baseline.ts` (manual smoke test only); the library function underneath gets full TDD coverage.

---

### Task 1: Diff engine core (`diffKafkaMessages`)

**Files:**
- Modify: `packages/server/src/kafka-check-logic.ts` (export `payloadOf`)
- Modify: `packages/server/src/kafka-check-definitions.ts` (add `diffIgnoreFields?: string[]` to `KafkaTopicDefinition`)
- Create: `packages/server/src/kafka-diff-engine.ts`
- Test: `packages/server/test/kafka-diff-engine.test.ts`

**Interfaces:**
- Consumes: `KAFKA_TOPIC_DEFINITIONS`, `KafkaTopicKey` from `./kafka-check-definitions.js`; `payloadOf(message: unknown, topic: KafkaTopicKey): Record<string, unknown> | undefined` from `./kafka-check-logic.js` (currently private — this task exports it).
- Produces: `diffKafkaMessages(baselineMessages: unknown[], actualMessages: unknown[], topic: KafkaTopicKey): DiffReport`, plus the exported types `DiffSeverity`, `DiffFindingKind`, `DiffFinding`, `DiffReport` from `packages/server/src/kafka-diff-engine.ts` — Task 2's CLI script imports all of these.

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/kafka-diff-engine.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { diffKafkaMessages } from '../src/kafka-diff-engine.js';

function transLog(overrides: Record<string, unknown>) {
  return {
    logType: 1,
    data: {
      transID: 1,
      appID: 2553,
      appTransID: 'tx-abc',
      amount: 10000,
      status: 'SUCCESS',
      updDate: '2026-01-01T00:00:00Z',
      ...overrides,
    },
  };
}

function paymentAuth(overrides: Record<string, unknown>) {
  return {
    order_no: 'order-1',
    payment_no: 'pay-1',
    status: 'PROCESSING',
    ...overrides,
  };
}

describe('diffKafkaMessages', () => {
  it('returns passed with no findings when baseline and actual are identical', () => {
    const messages = [transLog({})];
    const report = diffKafkaMessages(messages, messages, 'transLogV1');
    expect(report).toEqual({ result: 'passed', findings: [] });
  });

  it('reports a critical missing-message finding when a baseline status never appears in actual', () => {
    const baseline = [transLog({ status: 'PENDING' }), transLog({ status: 'SUCCESS' })];
    const actual = [transLog({ status: 'SUCCESS' })];
    const report = diffKafkaMessages(baseline, actual, 'transLogV1');
    expect(report.result).toBe('failed');
    expect(report.findings).toContainEqual(
      expect.objectContaining({ kind: 'missing-message', status: 'PENDING', severity: 'critical' })
    );
  });

  it('reports an info extra-message finding when actual has a status not in baseline, without failing the report', () => {
    const baseline = [transLog({ status: 'SUCCESS' })];
    const actual = [transLog({ status: 'SUCCESS' }), transLog({ status: 'FAILED' })];
    const report = diffKafkaMessages(baseline, actual, 'transLogV1');
    expect(report.result).toBe('passed');
    expect(report.findings).toContainEqual(
      expect.objectContaining({ kind: 'extra-message', status: 'FAILED', severity: 'info' })
    );
  });

  it('reports a critical missing-field finding when a matched actual message drops a field', () => {
    const baseline = [transLog({})];
    const actual = [
      {
        logType: 1,
        data: {
          transID: 1,
          appID: 2553,
          appTransID: 'tx-abc',
          status: 'SUCCESS',
          updDate: '2026-01-01T00:00:00Z',
        },
      },
    ];
    const report = diffKafkaMessages(baseline, actual, 'transLogV1');
    expect(report.result).toBe('failed');
    expect(report.findings).toContainEqual(
      expect.objectContaining({ kind: 'missing-field', status: 'SUCCESS', field: 'amount', severity: 'critical', baselineValue: 10000 })
    );
  });

  it('reports an info extra-field finding when a matched actual message has a field baseline lacks', () => {
    const baseline = [transLog({})];
    const actual = [transLog({ note: 'added later' })];
    const report = diffKafkaMessages(baseline, actual, 'transLogV1');
    expect(report.result).toBe('passed');
    expect(report.findings).toContainEqual(
      expect.objectContaining({ kind: 'extra-field', status: 'SUCCESS', field: 'note', severity: 'info', actualValue: 'added later' })
    );
  });

  it('reports a warning changed-field finding when a matched field value differs, without failing the report', () => {
    const baseline = [transLog({ amount: 10000 })];
    const actual = [transLog({ amount: 20000 })];
    const report = diffKafkaMessages(baseline, actual, 'transLogV1');
    expect(report.result).toBe('passed');
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        kind: 'changed-field',
        status: 'SUCCESS',
        field: 'amount',
        severity: 'warning',
        baselineValue: 10000,
        actualValue: 20000,
      })
    );
  });

  it('does not report a finding for fields ending in "time" or "date", case-insensitively', () => {
    const baseline = [transLog({ updDate: '2026-01-01T00:00:00Z', appTime: 1000 })];
    const actual = [transLog({ updDate: '2026-02-02T00:00:00Z', appTime: 2000 })];
    const report = diffKafkaMessages(baseline, actual, 'transLogV1');
    expect(report).toEqual({ result: 'passed', findings: [] });
  });

  it('does not report a finding for the topic correlator fields even when they differ across runs', () => {
    const baseline = [transLog({ transID: 111, appTransID: 'tx-111' })];
    const actual = [transLog({ transID: 222, appTransID: 'tx-222' })];
    const report = diffKafkaMessages(baseline, actual, 'transLogV1');
    expect(report).toEqual({ result: 'passed', findings: [] });
  });

  it('uses only the first occurrence of a duplicated status on either side', () => {
    const baseline = [transLog({ amount: 10000 }), transLog({ amount: 99999 })];
    const actual = [transLog({ amount: 10000 })];
    const report = diffKafkaMessages(baseline, actual, 'transLogV1');
    expect(report).toEqual({ result: 'passed', findings: [] });
  });

  it('fails the report when a critical finding exists alongside warning/info findings', () => {
    const baseline = [transLog({ status: 'PENDING' }), transLog({ status: 'SUCCESS', amount: 10000 })];
    const actual = [transLog({ status: 'SUCCESS', amount: 20000, note: 'x' })];
    const report = diffKafkaMessages(baseline, actual, 'transLogV1');
    expect(report.result).toBe('failed');
    expect(report.findings.map((f) => f.kind).sort()).toEqual(['changed-field', 'extra-field', 'missing-message']);
  });

  it('works for paymentAuth, a flat (non-wrapped) topic', () => {
    const baseline = [paymentAuth({})];
    const actual = [paymentAuth({ order_no: 'order-2' })];
    const report = diffKafkaMessages(baseline, actual, 'paymentAuth');
    expect(report).toEqual({ result: 'passed', findings: [] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/server test -- kafka-diff-engine.test.ts`
Expected: FAIL — `Cannot find module '../src/kafka-diff-engine.js'` (or similar resolution error), since the module doesn't exist yet.

- [ ] **Step 3: Export `payloadOf`, add `diffIgnoreFields` to the topic definition type, and implement `diffKafkaMessages`**

In `packages/server/src/kafka-check-logic.ts`, change the private helper to an exported one (only the `function` keyword changes — no other line in this file changes):

```ts
export function payloadOf(message: unknown, topic: KafkaTopicKey): Record<string, unknown> | undefined {
```

In `packages/server/src/kafka-check-definitions.ts`, add the new optional field to the interface:

```ts
export interface KafkaTopicDefinition {
  correlatorFields: string[];
  hasDataWrapper: boolean;
  requiredFields?: string[];
  diffIgnoreFields?: string[];
}
```

None of the three topic entries in `KAFKA_TOPIC_DEFINITIONS` need `diffIgnoreFields` set — the diff engine falls back to `correlatorFields` when it's absent.

Create `packages/server/src/kafka-diff-engine.ts`:

```ts
import { KAFKA_TOPIC_DEFINITIONS, type KafkaTopicKey } from './kafka-check-definitions.js';
import { payloadOf } from './kafka-check-logic.js';

export type DiffSeverity = 'critical' | 'warning' | 'info';

export type DiffFindingKind =
  | 'missing-message'
  | 'extra-message'
  | 'missing-field'
  | 'extra-field'
  | 'changed-field';

export interface DiffFinding {
  kind: DiffFindingKind;
  status: string;
  field?: string;
  severity: DiffSeverity;
  baselineValue?: unknown;
  actualValue?: unknown;
}

export interface DiffReport {
  result: 'passed' | 'failed';
  findings: DiffFinding[];
}

const SEVERITY_BY_KIND: Record<DiffFindingKind, DiffSeverity> = {
  'missing-message': 'critical',
  'extra-message': 'info',
  'missing-field': 'critical',
  'extra-field': 'info',
  'changed-field': 'warning',
};

function isIgnoredField(field: string, ignoreFields: string[]): boolean {
  const lower = field.toLowerCase();
  if (lower.endsWith('time') || lower.endsWith('date')) {
    return true;
  }
  return ignoreFields.includes(field);
}

function groupByStatus(messages: unknown[], topic: KafkaTopicKey): Map<string, Record<string, unknown>> {
  const groups = new Map<string, Record<string, unknown>>();
  for (const message of messages) {
    const payload = payloadOf(message, topic);
    if (!payload) {
      continue;
    }
    const status = payload.status;
    if (typeof status !== 'string' || groups.has(status)) {
      continue;
    }
    groups.set(status, payload);
  }
  return groups;
}

export function diffKafkaMessages(
  baselineMessages: unknown[],
  actualMessages: unknown[],
  topic: KafkaTopicKey
): DiffReport {
  const definition = KAFKA_TOPIC_DEFINITIONS[topic];
  const ignoreFields = definition.diffIgnoreFields ?? definition.correlatorFields;

  const baselineByStatus = groupByStatus(baselineMessages, topic);
  const actualByStatus = groupByStatus(actualMessages, topic);

  const findings: DiffFinding[] = [];

  for (const [status, baselinePayload] of baselineByStatus) {
    const actualPayload = actualByStatus.get(status);
    if (!actualPayload) {
      findings.push({
        kind: 'missing-message',
        status,
        severity: SEVERITY_BY_KIND['missing-message'],
        baselineValue: baselinePayload,
      });
      continue;
    }

    const fields = new Set([...Object.keys(baselinePayload), ...Object.keys(actualPayload)]);
    for (const field of fields) {
      if (isIgnoredField(field, ignoreFields)) {
        continue;
      }
      const inBaseline = field in baselinePayload;
      const inActual = field in actualPayload;
      if (inBaseline && !inActual) {
        findings.push({
          kind: 'missing-field',
          status,
          field,
          severity: SEVERITY_BY_KIND['missing-field'],
          baselineValue: baselinePayload[field],
        });
      } else if (!inBaseline && inActual) {
        findings.push({
          kind: 'extra-field',
          status,
          field,
          severity: SEVERITY_BY_KIND['extra-field'],
          actualValue: actualPayload[field],
        });
      } else if (JSON.stringify(baselinePayload[field]) !== JSON.stringify(actualPayload[field])) {
        findings.push({
          kind: 'changed-field',
          status,
          field,
          severity: SEVERITY_BY_KIND['changed-field'],
          baselineValue: baselinePayload[field],
          actualValue: actualPayload[field],
        });
      }
    }
  }

  for (const [status, actualPayload] of actualByStatus) {
    if (!baselineByStatus.has(status)) {
      findings.push({
        kind: 'extra-message',
        status,
        severity: SEVERITY_BY_KIND['extra-message'],
        actualValue: actualPayload,
      });
    }
  }

  const result: DiffReport['result'] = findings.some((f) => f.severity === 'critical') ? 'failed' : 'passed';

  return { result, findings };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/server test -- kafka-diff-engine.test.ts`
Expected: PASS, 11 tests.

Also run the full server suite to confirm exporting `payloadOf` didn't break anything (`kafka-check-logic.test.ts` imports `extractCorrelatorValues`/`checkRequiredFields`, not `payloadOf`, by name — this should be a no-op change for existing tests):

Run: `pnpm --filter @ai-native-testing/server test`
Expected: PASS, all existing tests plus the 11 new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/kafka-check-logic.ts packages/server/src/kafka-check-definitions.ts packages/server/src/kafka-diff-engine.ts packages/server/test/kafka-diff-engine.test.ts
git commit -m "feat(server): add diffKafkaMessages, a pure baseline-vs-actual Kafka message comparator"
```

---

### Task 2: `compare-baselines` CLI script

**Files:**
- Create: `packages/web/scripts/compare-baselines.ts`
- Modify: `packages/web/package.json` (add `"compare-baselines"` script)

**Interfaces:**
- Consumes: `diffKafkaMessages`, `DiffFinding` (type), `DiffReport` (type) from `@ai-native-testing/server/src/kafka-diff-engine.js`; `KafkaTopicKey` (type) from `@ai-native-testing/server/src/kafka-check-definitions.js` — both via the deep-import-only convention already established (never the bare `@ai-native-testing/server` specifier, since its `main` boots a real server — see the workspace's project memory on this).
- Produces: nothing consumed by later tasks — this is the sub-project's last CLI entry point until Step 4.

- [ ] **Step 1: Write the CLI script**

Create `packages/web/scripts/compare-baselines.ts`:

```ts
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { diffKafkaMessages, type DiffFinding } from '@ai-native-testing/server/src/kafka-diff-engine.js';
import type { KafkaTopicKey } from '@ai-native-testing/server/src/kafka-check-definitions.js';

interface BaselineFile {
  capturedAt: string;
  version: string;
  status: string;
  durationMs: number;
  messages: unknown[];
}

async function readBaselineFile(path: string): Promise<BaselineFile> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    throw new Error(`Could not read file at ${path}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Could not parse ${path} as JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { messages?: unknown }).messages)) {
    throw new Error(`${path} does not look like a baseline file (missing a "messages" array)`);
  }
  return parsed as BaselineFile;
}

function formatFinding(finding: DiffFinding): string {
  const parts = [finding.severity.toUpperCase(), finding.kind, `status=${finding.status}`];
  if (finding.field) {
    parts.push(`field=${finding.field}`);
  }
  if (finding.baselineValue !== undefined) {
    parts.push(`baseline=${JSON.stringify(finding.baselineValue)}`);
  }
  if (finding.actualValue !== undefined) {
    parts.push(`actual=${JSON.stringify(finding.actualValue)}`);
  }
  return parts.join(' ');
}

const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    actual: { type: 'string' },
    topic: { type: 'string' },
  },
});

if (!values.baseline || !values.actual || !values.topic) {
  console.error('Usage: compare-baselines.ts --baseline <path> --actual <path> --topic <transLogV1|refundLog|paymentAuth>');
  process.exit(1);
}

const baselineFile = await readBaselineFile(values.baseline);
const actualFile = await readBaselineFile(values.actual);

const report = diffKafkaMessages(baselineFile.messages, actualFile.messages, values.topic as KafkaTopicKey);

if (report.findings.length === 0) {
  console.log('No differences found.');
} else {
  for (const finding of report.findings) {
    console.log(formatFinding(finding));
  }
}
console.log(`Result: ${report.result.toUpperCase()}`);

process.exit(report.result === 'passed' ? 0 : 1);
```

- [ ] **Step 2: Add the npm script**

In `packages/web/package.json`, add to `"scripts"` (alongside the existing `capture-baseline`/`update-baseline` entries):

```json
"compare-baselines": "tsx scripts/compare-baselines.ts",
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: PASS, no errors.

- [ ] **Step 4: Manual smoke test**

From `packages/web`, create two temporary baseline-shaped fixture files and run the script against them — once where they should PASS, once where they should FAIL:

```bash
cd packages/web
TMPDIR_FIXTURES=$(mktemp -d)

cat > "$TMPDIR_FIXTURES/baseline.json" <<'EOF'
{
  "capturedAt": "2026-08-12T00:00:00.000Z",
  "version": "1.0.0",
  "status": "SUCCESS",
  "durationMs": 1200,
  "messages": [
    { "data": { "appTransID": "tx-1", "transID": 1, "amount": 10000, "status": "SUCCESS" } }
  ]
}
EOF

cat > "$TMPDIR_FIXTURES/actual-matching.json" <<'EOF'
{
  "capturedAt": "2026-08-12T01:00:00.000Z",
  "version": "1.0.0",
  "status": "SUCCESS",
  "durationMs": 1300,
  "messages": [
    { "data": { "appTransID": "tx-2", "transID": 2, "amount": 10000, "status": "SUCCESS" } }
  ]
}
EOF

cat > "$TMPDIR_FIXTURES/actual-broken.json" <<'EOF'
{
  "capturedAt": "2026-08-12T02:00:00.000Z",
  "version": "1.0.0",
  "status": "SUCCESS",
  "durationMs": 1300,
  "messages": [
    { "data": { "appTransID": "tx-3", "transID": 3, "status": "SUCCESS" } }
  ]
}
EOF

npx tsx scripts/compare-baselines.ts --baseline "$TMPDIR_FIXTURES/baseline.json" --actual "$TMPDIR_FIXTURES/actual-matching.json" --topic transLogV1
echo "exit code: $?"

npx tsx scripts/compare-baselines.ts --baseline "$TMPDIR_FIXTURES/baseline.json" --actual "$TMPDIR_FIXTURES/actual-broken.json" --topic transLogV1
echo "exit code: $?"

rm -rf "$TMPDIR_FIXTURES"
```

Expected: the first invocation prints `No differences found.` / `Result: PASSED` and `exit code: 0`; the second prints a `CRITICAL missing-field status=SUCCESS field=amount ...` line, `Result: FAILED`, and `exit code: 1`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/scripts/compare-baselines.ts packages/web/package.json
git commit -m "feat(web): add compare-baselines CLI script for the Kafka diff engine"
```
