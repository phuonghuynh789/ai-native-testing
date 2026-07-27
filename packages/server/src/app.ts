import Fastify, { type FastifyInstance } from 'fastify';
import { RunnerRegistry } from '@ai-native-testing/engine';
import { LogRunner } from '@ai-native-testing/runner-log';
import { JobStore } from './job-store.js';
import { registerRunRoutes } from './routes/runs.js';

export function buildApp(): FastifyInstance {
  const app = Fastify();
  const registry = new RunnerRegistry();
  registry.register(new LogRunner());
  const jobStore = new JobStore();

  registerRunRoutes(app, jobStore, registry);

  return app;
}
