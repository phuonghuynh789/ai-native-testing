import type { FastifyInstance } from 'fastify';
import { listServices } from '@ai-native-testing/runner-grpc';

export function registerGrpcRoutes(app: FastifyInstance): void {
  app.post('/grpc/introspect', async (request, reply) => {
    const { proto } = (request.body ?? {}) as { proto?: string };
    if (!proto || proto.trim() === '') {
      return reply.code(400).send({ error: 'proto is required' });
    }
    try {
      const services = listServices(proto);
      return { services };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
