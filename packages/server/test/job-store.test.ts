import { describe, it, expect } from 'vitest';
import { RunnerRegistry, type Runner, type TestDefinition, type RunEvent } from '@ai-native-testing/engine';
import { JobStore } from '../src/job-store.js';

function makeStubRunner(): Runner {
  return {
    name: 'log',
    async interact() {},
    async ask(_action, args) {
      return (args as { value: unknown }).value;
    },
  };
}

function makeRegistry(runner: Runner): RunnerRegistry {
  const registry = new RunnerRegistry();
  registry.register(runner);
  return registry;
}

function waitForFinish(store: JobStore, jobId: string): Promise<RunEvent> {
  return new Promise((resolve) => {
    const unsubscribe = store.subscribe(jobId, (event) => {
      if (event.type === 'run:completed' || event.type === 'run:failed') {
        unsubscribe();
        resolve(event);
      }
    });
  });
}

const passingDefinition: TestDefinition = {
  actor: { name: 'Customer', abilities: ['log'] },
  tasks: [
    {
      name: 'Create Payment',
      steps: [
        { type: 'interaction', runner: 'log', action: 'log', with: { message: 'hi' } },
        { type: 'question', runner: 'log', action: 'echo', with: { value: 201 }, expect: { equals: 201 } },
      ],
    },
  ],
};

const failingDefinition: TestDefinition = {
  actor: { name: 'Customer', abilities: ['log'] },
  tasks: [
    {
      name: 'Create Payment',
      steps: [
        { type: 'question', runner: 'log', action: 'echo', with: { value: 500 }, expect: { equals: 201 } },
        { type: 'interaction', runner: 'log', action: 'log', with: { message: 'unreachable' } },
      ],
    },
  ],
};

describe('JobStore', () => {
  it('creates a job in the running state with pending steps', () => {
    const store = new JobStore();
    const jobId = store.createJob(passingDefinition, makeRegistry(makeStubRunner()));
    const job = store.getJob(jobId);
    expect(job?.status).toBe('running');
    expect(job?.steps).toHaveLength(2);
    expect(job?.steps.every((s) => s.status === 'pending')).toBe(true);
  });

  it('marks a job passed with all steps passed once execution finishes', async () => {
    const store = new JobStore();
    const jobId = store.createJob(passingDefinition, makeRegistry(makeStubRunner()));
    await waitForFinish(store, jobId);
    const job = store.getJob(jobId);
    expect(job?.status).toBe('passed');
    expect(job?.steps.every((s) => s.status === 'passed')).toBe(true);
    expect(job?.finishedAt).toBeDefined();
  });

  it('marks remaining steps skipped when a job fails fast', async () => {
    const store = new JobStore();
    const jobId = store.createJob(failingDefinition, makeRegistry(makeStubRunner()));
    await waitForFinish(store, jobId);
    const job = store.getJob(jobId);
    expect(job?.status).toBe('failed');
    expect(job?.steps[0].status).toBe('failed');
    expect(job?.steps[1].status).toBe('skipped');
  });

  it('records event history that can be replayed', async () => {
    const store = new JobStore();
    const jobId = store.createJob(passingDefinition, makeRegistry(makeStubRunner()));
    await waitForFinish(store, jobId);
    const history = store.getHistory(jobId);
    expect(history.at(-1)).toEqual({ type: 'run:completed' });
  });

  it('returns undefined for an unknown job id', () => {
    const store = new JobStore();
    expect(store.getJob('does-not-exist')).toBeUndefined();
  });
});
