import { collectKafkaMessages } from '@ai-native-testing/server/src/kafka-message-collector.js';
import { loadKafkaConfig } from '@ai-native-testing/server/src/kafka-config.js';
import { KAFKA_TOPIC_DEFINITIONS, type KafkaTopicKey } from '@ai-native-testing/server/src/kafka-check-definitions.js';
import { buildTestDefinition } from '../src/dsl.js';
import { extractCorrelatorValue } from '../src/kafkaChecks.js';
import type { FormState } from '../src/types.js';

export interface RunCaptureOptions {
  serverUrl: string;
  kafkaConfigPath: string;
  stepName: string;
  topic: KafkaTopicKey;
  idleTimeoutMs: number;
  terminalStatuses: string[];
}

export interface RunCaptureResult {
  status: string;
  durationMs: number;
  messages: unknown[];
}

export async function runCapture(options: RunCaptureOptions): Promise<RunCaptureResult> {
  const stepResponse = await fetch(`${options.serverUrl}/steps/${encodeURIComponent(options.stepName)}`);
  if (!stepResponse.ok) {
    throw new Error(`Could not fetch saved step "${options.stepName}": HTTP ${stepResponse.status}`);
  }
  const form = (await stepResponse.json()) as FormState;

  const definition = buildTestDefinition(form);
  const transId = extractCorrelatorValue(form, options.topic);
  if (transId === undefined) {
    throw new Error(
      `Could not extract a correlator value for topic "${options.topic}" from step "${options.stepName}"`
    );
  }

  const kafkaConfig = loadKafkaConfig(options.kafkaConfigPath);
  if (!kafkaConfig) {
    throw new Error(`Could not load Kafka config from ${options.kafkaConfigPath}`);
  }
  const topicConfig = kafkaConfig.topics[options.topic];
  const topicDefinition = KAFKA_TOPIC_DEFINITIONS[options.topic];

  const collectorPromise = collectKafkaMessages({
    brokers: topicConfig.brokers,
    topic: topicConfig.topic,
    transId,
    correlatorFields: topicDefinition.correlatorFields,
    statusField: 'status',
    hasDataWrapper: topicDefinition.hasDataWrapper,
    terminalStatuses: options.terminalStatuses,
    idleTimeoutMs: options.idleTimeoutMs,
    ssl: topicConfig.ssl,
    sasl: topicConfig.sasl,
  });

  const runResponse = await fetch(`${options.serverUrl}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(definition),
  });
  if (!runResponse.ok) {
    throw new Error(`Could not start the run for step "${options.stepName}": HTTP ${runResponse.status}`);
  }

  const result = await collectorPromise;
  if (result.terminatedBy !== 'terminal-status') {
    throw new Error(
      `Capture timed out after ${result.durationMs}ms waiting for a terminal status ` +
        `(received: ${result.receivedStatuses.join(', ') || 'none'}); no baseline was written.`
    );
  }

  return {
    status: result.receivedStatuses[result.receivedStatuses.length - 1],
    durationMs: result.durationMs,
    messages: result.messages,
  };
}
