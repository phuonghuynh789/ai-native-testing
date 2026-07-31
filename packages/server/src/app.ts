import Fastify, { type FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RunnerRegistry } from '@ai-native-testing/engine';
import { LogRunner } from '@ai-native-testing/runner-log';
import { RestRunner } from '@ai-native-testing/runner-api';
import { GrpcRunner } from '@ai-native-testing/runner-grpc';
import { JobStore } from './job-store.js';
import { registerRunRoutes } from './routes/runs.js';
import { NameListStore } from './name-list-store.js';
import { registerNameListRoutes } from './routes/name-lists.js';
import { StepStore } from './step-store.js';
import { registerStepRoutes } from './routes/steps.js';
import { FlowStore } from './flow-store.js';
import { registerFlowRoutes } from './routes/flows.js';
import { registerGrpcRoutes } from './routes/grpc.js';

const DEFAULT_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

export interface BuildAppOptions {
  dataDir?: string;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify();
  const registry = new RunnerRegistry();
  registry.register(new LogRunner());
  registry.register(new RestRunner());
  registry.register(new GrpcRunner());
  const jobStore = new JobStore();

  registerRunRoutes(app, jobStore, registry);
  registerGrpcRoutes(app);

  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const actorStore = new NameListStore(join(dataDir, 'actors.json'));
  const taskStore = new NameListStore(join(dataDir, 'tasks.json'));
  registerNameListRoutes(app, actorStore, taskStore);

  const stepStore = new StepStore(join(dataDir, 'steps.json'));
  registerStepRoutes(app, stepStore);

  const flowStore = new FlowStore(join(dataDir, 'flows.json'));
  registerFlowRoutes(app, flowStore);

  return app;
}
