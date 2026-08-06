import type { FastifyInstance } from 'fastify';
import type { KafkaCheckStore } from '../kafka-check-store.js';
import { KAFKA_TOPIC_KEYS, type KafkaTopicKey } from '../kafka-check-definitions.js';

export function registerKafkaCheckRoutes(app: FastifyInstance, store: KafkaCheckStore): void {
  app.get('/kafka-checks', async () => store.list());

  app.post('/kafka-checks', async (request, reply) => {
    const { message_id, name, topic } = (request.body ?? {}) as {
      message_id?: string;
      name?: string;
      topic?: string;
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
    const now = new Date().toISOString();
    const row = {
      message_id,
      name,
      topic,
      status: 'pending' as const,
      missingFields: [],
      matchedMessage: null,
      created_at: now,
      updated_at: now,
      retry_count: 0,
    };
    await store.create(row);
    return reply.code(201).send(row);
  });
}
