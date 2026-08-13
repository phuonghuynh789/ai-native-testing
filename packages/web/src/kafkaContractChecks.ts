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
