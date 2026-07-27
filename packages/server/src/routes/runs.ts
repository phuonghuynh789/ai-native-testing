import type { FastifyInstance } from 'fastify';
import { validateTestDefinition, type RunnerRegistry, type TestDefinition } from '@ai-native-testing/engine';
import type { JobStore } from '../job-store.js';

export function registerRunRoutes(app: FastifyInstance, jobStore: JobStore, registry: RunnerRegistry): void {
  app.post('/runs', async (request, reply) => {
    const { valid, errors } = validateTestDefinition(request.body);
    if (!valid) {
      return reply.code(400).send({ errors });
    }
    const jobId = jobStore.createJob(request.body as TestDefinition, registry);
    return reply.code(202).send({ jobId });
  });

  app.get('/runs/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = jobStore.getJob(jobId);
    if (!job) {
      return reply.code(404).send({ error: 'job not found' });
    }
    return reply.send(job);
  });

  app.get('/runs/:jobId/events', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = jobStore.getJob(jobId);
    if (!job) {
      return reply.code(404).send({ error: 'job not found' });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    for (const event of jobStore.getHistory(jobId)) {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    if (job.status === 'passed' || job.status === 'failed') {
      reply.raw.end();
      return;
    }

    const unsubscribe = jobStore.subscribe(jobId, (event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === 'run:completed' || event.type === 'run:failed') {
        reply.raw.end();
      }
    });

    request.raw.on('close', unsubscribe);
  });
}
