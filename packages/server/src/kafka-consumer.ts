import { Kafka } from 'kafkajs';
import type { KafkaConfig } from './kafka-config.js';
import { KAFKA_TOPIC_KEYS, type KafkaTopicKey } from './kafka-check-definitions.js';
import { extractCorrelatorValue, checkRequiredFields, isTimedOut } from './kafka-check-logic.js';
import type { KafkaCheckStore } from './kafka-check-store.js';

const TIMEOUT_MS = 60_000;
const SWEEP_INTERVAL_MS = 5_000;

export async function handleIncomingMessage(
  topic: KafkaTopicKey,
  rawValue: string,
  store: KafkaCheckStore
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return;
  }

  const correlatorValue = extractCorrelatorValue(parsed, topic);
  if (correlatorValue === undefined) {
    return;
  }

  const row = await store.get(correlatorValue);
  if (!row || row.topic !== topic || row.status !== 'pending') {
    return;
  }

  await store.update(correlatorValue, { status: 'received' });
  const missingFields = checkRequiredFields(parsed, topic);
  await store.update(correlatorValue, {
    status: missingFields.length === 0 ? 'passed' : 'failed',
    missingFields,
    matchedMessage: parsed,
  });
}

export async function sweepTimedOutChecks(store: KafkaCheckStore): Promise<void> {
  const rows = await store.list();
  const now = Date.now();
  for (const row of rows) {
    if (isTimedOut(row, now, TIMEOUT_MS)) {
      await store.update(row.message_id, {
        status: 'failed',
        missingFields: ['(timeout: no message received)'],
        retry_count: row.retry_count + 1,
      });
    }
  }
}

async function startConsumerForTopic(
  topicKey: KafkaTopicKey,
  config: KafkaConfig,
  store: KafkaCheckStore
): Promise<void> {
  const topicConfig = config.topics[topicKey];
  const kafka = new Kafka({ brokers: topicConfig.brokers });
  const consumer = kafka.consumer({ groupId: `${config.groupID}-${topicKey}` });
  await consumer.connect();
  await consumer.subscribe({ topic: topicConfig.topic, fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ message }) => {
      await handleIncomingMessage(topicKey, message.value?.toString('utf8') ?? '', store);
    },
  });
}

export async function startKafkaConsumers(config: KafkaConfig, store: KafkaCheckStore): Promise<void> {
  // Scheduled before any topic attempts to connect, and each topic's connection failure is
  // isolated below — so a single unreachable broker can never prevent the sweep from running
  // (which guarantees every pending check eventually resolves to failed) or block other topics.
  setInterval(() => {
    sweepTimedOutChecks(store).catch(() => {
      // Best-effort sweep; a failed sweep cycle is retried on the next interval tick.
    });
  }, SWEEP_INTERVAL_MS);

  for (const topicKey of KAFKA_TOPIC_KEYS) {
    startConsumerForTopic(topicKey, config, store).catch(() => {
      // Best-effort per topic; a topic whose broker is unreachable does not affect the others
      // or the timeout sweep above.
    });
  }
}
