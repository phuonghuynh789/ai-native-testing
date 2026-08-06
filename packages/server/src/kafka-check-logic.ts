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
