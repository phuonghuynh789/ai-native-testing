import type { FastifyInstance } from 'fastify';
import type { StepStore } from '../step-store.js';

export function registerStepRoutes(app: FastifyInstance, stepStore: StepStore): void {
  app.get('/steps', async () => stepStore.list());

  app.get('/steps/search', async (request) => {
    const { search, page, pageSize } = request.query as { search?: string; page?: string; pageSize?: string };
    return stepStore.search(search ?? '', Number(page) || 1, Number(pageSize) || 20);
  });

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

  app.delete('/steps/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const names = await stepStore.delete(name);
    if (names === undefined) {
      return reply.code(404).send({ error: 'not found' });
    }
    return { names };
  });
}
