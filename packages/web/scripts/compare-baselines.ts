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
