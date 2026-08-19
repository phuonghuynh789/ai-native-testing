import { randomUUID } from 'node:crypto';
import { Kafka } from 'kafkajs';
import type { KafkaSaslConfig } from './kafka-config.js';

export interface CollectKafkaMessagesOptions {
  brokers: string[];
  topic: string;
  transId: string;
  correlatorFields: string[];
  statusField: string;
  hasDataWrapper: boolean;
  terminalStatuses: string[];
  idleTimeoutMs: number;
  startFromMs?: number;
  ssl?: boolean;
  sasl?: KafkaSaslConfig;
}

export interface CollectKafkaMessagesResult {
  messages: unknown[];
  receivedStatuses: string[];
  terminatedBy: 'terminal-status' | 'idle-timeout';
  durationMs: number;
}

export async function collectKafkaMessages(
  options: CollectKafkaMessagesOptions
): Promise<CollectKafkaMessagesResult> {
  const startedAt = Date.now();
  const startFromMs = options.startFromMs ?? startedAt;
  const kafka = new Kafka({
    brokers: options.brokers,
    ...(options.ssl !== undefined ? { ssl: options.ssl } : {}),
    ...(options.sasl !== undefined ? { sasl: options.sasl } : {}),
  });
  const consumer = kafka.consumer({ groupId: `verifier-${randomUUID()}` });
  const admin = kafka.admin();

  const messages: unknown[] = [];
  const receivedStatuses = new Set<string>();

  return new Promise<CollectKafkaMessagesResult>((resolve, reject) => {
    let idleTimer: ReturnType<typeof setTimeout>;
    let settled = false;

    function finish(terminatedBy: 'terminal-status' | 'idle-timeout') {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(idleTimer);
      const result: CollectKafkaMessagesResult = {
        messages,
        receivedStatuses: [...receivedStatuses],
        terminatedBy,
        durationMs: Date.now() - startedAt,
      };
      consumer
        .disconnect()
        .catch(() => {})
        .finally(() => resolve(result));
    }

    function resetIdleTimer() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish('idle-timeout'), options.idleTimeoutMs);
    }

    async function start() {
      await consumer.connect();
      await consumer.subscribe({ topic: options.topic, fromBeginning: false });

      await admin.connect();
      const offsets = await admin.fetchTopicOffsetsByTimestamp(options.topic, startFromMs);
      await admin.disconnect();

      consumer.on(consumer.events.GROUP_JOIN, () => {
        for (const { partition, offset } of offsets) {
          consumer.seek({ topic: options.topic, partition, offset });
        }
      });

      resetIdleTimer();

      await consumer.run({
        eachMessage: async ({ message }: { message: { value: Buffer | null } }) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(message.value?.toString('utf8') ?? '');
          } catch {
            return;
          }
          if (typeof parsed !== 'object' || parsed === null) {
            return;
          }
          const record = parsed as Record<string, unknown>;
          let payload: Record<string, unknown> | undefined = record;
          if (options.hasDataWrapper) {
            const data = record.data;
            payload = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : undefined;
          }
          if (!payload) {
            return;
          }
          const matches = options.correlatorFields.some((field) => {
            const correlatorValue = payload[field];
            return (
              correlatorValue !== undefined &&
              correlatorValue !== null &&
              String(correlatorValue) === options.transId
            );
          });
          if (!matches) {
            return;
          }

          messages.push(parsed);
          const status = payload[options.statusField];
          if (typeof status === 'string') {
            receivedStatuses.add(status);
            if (options.terminalStatuses.includes(status)) {
              finish('terminal-status');
              return;
            }
          }
          resetIdleTimer();
        },
      });
    }

    start().catch((err) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(idleTimer);
      consumer
        .disconnect()
        .catch(() => {})
        .finally(() => reject(err));
    });
  });
}
