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
