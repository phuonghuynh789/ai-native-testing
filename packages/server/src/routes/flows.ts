import type { FastifyInstance } from 'fastify';
import type { FlowStore } from '../flow-store.js';

export function registerFlowRoutes(app: FastifyInstance, flowStore: FlowStore): void {
  app.get('/flows', async () => flowStore.list());

  app.get('/flows/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const steps = await flowStore.get(name);
    if (steps === undefined) {
      return reply.code(404).send({ error: 'not found' });
    }
    return steps;
  });

  app.post('/flows', async (request, reply) => {
    const { flowName, stepName } = (request.body ?? {}) as { flowName?: string; stepName?: string };
    if (!flowName || flowName.trim() === '') {
      return reply.code(400).send({ error: 'flowName is required' });
    }
    if (!stepName || stepName.trim() === '') {
      return reply.code(400).send({ error: 'stepName is required' });
    }
    const names = await flowStore.addStep(flowName, stepName);
    return reply.code(201).send({ names });
  });

  app.put('/flows/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const { stepNames } = (request.body ?? {}) as { stepNames?: unknown };
    if (!Array.isArray(stepNames)) {
      return reply.code(400).send({ error: 'stepNames is required' });
    }
    const names = await flowStore.setSteps(name, stepNames as string[]);
    return reply.code(200).send({ names });
  });
}
