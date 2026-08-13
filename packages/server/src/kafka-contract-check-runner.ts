import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectKafkaMessages } from './kafka-message-collector.js';
import { diffKafkaMessages } from './kafka-diff-engine.js';
import { KAFKA_TOPIC_DEFINITIONS, type KafkaTopicKey } from './kafka-check-definitions.js';
import type { KafkaConfig } from './kafka-config.js';
import type { KafkaContractCheckRow, KafkaContractCheckStore } from './kafka-contract-check-store.js';

const IDLE_TIMEOUT_MS = 15_000;
const TERMINAL_STATUSES = ['SUCCESS', 'FAILED'];

interface BaselineFile {
  messages: unknown[];
}

export async function runKafkaContractCheck(
  row: KafkaContractCheckRow,
  kafkaConfig: KafkaConfig,
  baselinesDir: string,
  store: KafkaContractCheckStore
): Promise<void> {
  const topic = row.topic as KafkaTopicKey;
  const topicConfig = kafkaConfig.topics[topic];
  const topicDefinition = KAFKA_TOPIC_DEFINITIONS[topic];

  let result;
  try {
    result = await collectKafkaMessages({
      brokers: topicConfig.brokers,
      topic: topicConfig.topic,
      transId: row.message_id,
      correlatorField: topicDefinition.correlatorFields[0],
      statusField: 'status',
      hasDataWrapper: topicDefinition.hasDataWrapper,
      terminalStatuses: TERMINAL_STATUSES,
      idleTimeoutMs: IDLE_TIMEOUT_MS,
    });
  } catch (err) {
    await store.update(row.message_id, {
      status: 'error',
      errorMessage: `Kafka collection failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  if (result.terminatedBy !== 'terminal-status') {
    await store.update(row.message_id, {
      status: 'error',
      errorMessage: `Timed out after ${result.durationMs}ms waiting for a terminal status.`,
    });
    return;
  }

  const actualStatus = result.receivedStatuses[result.receivedStatuses.length - 1];
  const baselinePath = join(baselinesDir, row.version, `${actualStatus}.json`);
  let baselineFile: BaselineFile;
  try {
    const raw = await readFile(baselinePath, 'utf8');
    baselineFile = JSON.parse(raw) as BaselineFile;
  } catch {
    await store.update(row.message_id, {
      status: 'error',
      errorMessage: `No baseline found at ${row.version}/${actualStatus}.json`,
    });
    return;
  }

  const diffReport = diffKafkaMessages(baselineFile.messages, result.messages, topic);
  await store.update(row.message_id, { status: diffReport.result, diffReport });
}
