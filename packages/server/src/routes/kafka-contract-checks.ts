import type { FastifyInstance } from 'fastify';
import type { KafkaContractCheckStore } from '../kafka-contract-check-store.js';
import { KAFKA_TOPIC_KEYS, type KafkaTopicKey } from '../kafka-check-definitions.js';
import type { KafkaConfig } from '../kafka-config.js';
import { runKafkaContractCheck } from '../kafka-contract-check-runner.js';

export function registerKafkaContractCheckRoutes(
  app: FastifyInstance,
  store: KafkaContractCheckStore,
  kafkaConfig: KafkaConfig | undefined,
  baselinesDir: string
): void {
  app.get('/kafka-contract-checks', async () => store.list());

  app.post('/kafka-contract-checks', async (request, reply) => {
    const { message_id, name, topic, version } = (request.body ?? {}) as {
      message_id?: string;
      name?: string;
      topic?: string;
      version?: string;
    };
    if (!message_id || message_id.trim() === '') {
      return reply.code(400).send({ error: 'message_id is required' });
    }
    if (!name || name.trim() === '') {
      return reply.code(400).send({ error: 'name is required' });
    }
    if (!topic || !KAFKA_TOPIC_KEYS.includes(topic as KafkaTopicKey)) {
      return reply.code(400).send({ error: `topic must be one of: ${KAFKA_TOPIC_KEYS.join(', ')}` });
    }
    if (!version || version.trim() === '') {
      return reply.code(400).send({ error: 'version is required' });
    }
    if (!kafkaConfig) {
      return reply.code(503).send({ error: 'Kafka is not configured on this server' });
    }

    const now = new Date().toISOString();
    const row = {
      message_id,
      name,
      topic,
      version,
      status: 'pending' as const,
      diffReport: null,
      errorMessage: null,
      created_at: now,
      updated_at: now,
    };
    await store.create(row);
    runKafkaContractCheck(row, kafkaConfig, baselinesDir, store).catch(() => {
      // runKafkaContractCheck already handles every failure path internally by
      // updating the row to 'error' — this catch only guards against it throwing
      // synchronously in a way that would otherwise become an unhandled rejection.
    });
    return reply.code(201).send(row);
  });
}
