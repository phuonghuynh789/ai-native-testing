import type { FastifyInstance } from 'fastify';
import type { NameListStore } from '../name-list-store.js';

export function registerNameListRoutes(
  app: FastifyInstance,
  actorStore: NameListStore,
  taskStore: NameListStore
): void {
  app.get('/actors', async () => actorStore.list());
  app.post('/actors', async (request, reply) => {
    const { name } = (request.body ?? {}) as { name?: string };
    if (!name || name.trim() === '') {
      return reply.code(400).send({ error: 'name is required' });
    }
    const names = await actorStore.add(name);
    return reply.code(201).send({ names });
  });

  app.get('/tasks', async () => taskStore.list());
  app.post('/tasks', async (request, reply) => {
    const { name } = (request.body ?? {}) as { name?: string };
    if (!name || name.trim() === '') {
      return reply.code(400).send({ error: 'name is required' });
    }
    const names = await taskStore.add(name);
    return reply.code(201).send({ names });
  });
}
