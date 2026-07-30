import type { FastifyInstance } from 'fastify';
import type { StepStore } from '../step-store.js';

export function registerStepRoutes(app: FastifyInstance, stepStore: StepStore): void {
  app.get('/steps', async () => stepStore.list());

  app.get('/steps/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const content = await stepStore.get(name);
    if (content === undefined) {
      return reply.code(404).send({ error: 'not found' });
    }
    return content;
  });

  app.post('/steps', async (request, reply) => {
    const { name, content } = (request.body ?? {}) as { name?: string; content?: unknown };
    if (!name || name.trim() === '') {
      return reply.code(400).send({ error: 'name is required' });
    }
    if (content === undefined) {
      return reply.code(400).send({ error: 'content is required' });
    }
    const names = await stepStore.save(name, content);
    return reply.code(201).send({ names });
  });
}
