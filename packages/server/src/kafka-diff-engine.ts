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
