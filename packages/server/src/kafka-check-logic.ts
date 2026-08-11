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
