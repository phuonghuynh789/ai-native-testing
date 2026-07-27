import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { RunnerRegistry, type Runner } from '@ai-native-testing/engine';
import { buildApp } from '../src/app.js';
import { JobStore } from '../src/job-store.js';
import { registerRunRoutes } from '../src/routes/runs.js';

const validDefinition = {
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

const failingDefinition = {
  actor: { name: 'Customer', abilities: ['log'] },
  tasks: [
    {
      name: 'Create Payment',
      steps: [{ type: 'question', runner: 'log', action: 'echo', with: { value: 500 }, expect: { equals: 201 } }],
    },
  ],
};

// A `log`-named Runner whose `interact`/`ask` resolve only after a short
// delay, so a submitted job is still `running` by the time the test hits
// `GET /runs/:jobId/events` — unlike the real `LogRunner`, which resolves
// synchronously and leaves no window to observe live streaming.
const slowLogRunner: Runner = {
  name: 'log',
  async interact(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50));
  },
  async ask(_action, args): Promise<unknown> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return (args as { value: unknown }).value;
  },
};

function buildAppWithSlowRunner() {
  const app = Fastify();
  const registry = new RunnerRegistry();
  registry.register(slowLogRunner);
  const jobStore = new JobStore();
  registerRunRoutes(app, jobStore, registry);
  return app;
}

async function pollUntilFinished(app: ReturnType<typeof buildApp>, jobId: string) {
  for (let i = 0; i < 50; i++) {
    const res = await app.inject({ method: 'GET', url: `/runs/${jobId}` });
    const body = res.json();
    if (body.status === 'passed' || body.status === 'failed') {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('job did not finish in time');
}

describe('POST /runs', () => {
  it('accepts a valid test definition and returns a jobId', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: '/runs', payload: validDefinition });
    expect(res.statusCode).toBe(202);
    expect(res.json().jobId).toEqual(expect.any(String));
  });

  it('rejects an invalid test definition with 400 and errors', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: '/runs', payload: { tasks: [] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors.length).toBeGreaterThan(0);
  });
});

describe('GET /runs/:jobId', () => {
  it('returns 404 for an unknown job', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/runs/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });

  it('reports a passed job with all steps passed', async () => {
    const app = buildApp();
    const submit = await app.inject({ method: 'POST', url: '/runs', payload: validDefinition });
    const { jobId } = submit.json();
    const job = await pollUntilFinished(app, jobId);
    expect(job.status).toBe('passed');
    expect(job.steps.every((s: { status: string }) => s.status === 'passed')).toBe(true);
  });

  it('reports a failed job with skipped remaining steps', async () => {
    const app = buildApp();
    const submit = await app.inject({ method: 'POST', url: '/runs', payload: failingDefinition });
    const { jobId } = submit.json();
    const job = await pollUntilFinished(app, jobId);
    expect(job.status).toBe('failed');
    expect(job.steps[0].status).toBe('failed');
  });
});

describe('GET /runs/:jobId/events', () => {
  it('streams recorded events as server-sent events once the job has finished', async () => {
    const app = buildApp();
    const submit = await app.inject({ method: 'POST', url: '/runs', payload: validDefinition });
    const { jobId } = submit.json();
    await pollUntilFinished(app, jobId);

    const res = await app.inject({ method: 'GET', url: `/runs/${jobId}/events` });
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.payload).toContain('"type":"run:completed"');
  });

  it('returns 404 for an unknown job', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/runs/does-not-exist/events' });
    expect(res.statusCode).toBe(404);
  });

  it('streams live events for a job that is still running when the stream is opened', async () => {
    const app = buildAppWithSlowRunner();
    const submit = await app.inject({ method: 'POST', url: '/runs', payload: validDefinition });
    const { jobId } = submit.json();

    // Confirm the job hasn't finished yet, so the assertions below can only
    // be satisfied by the live `jobStore.subscribe` branch, not by replaying
    // an already-finished history.
    const snapshot = await app.inject({ method: 'GET', url: `/runs/${jobId}` });
    expect(snapshot.json().status).toBe('running');

    const res = await app.inject({ method: 'GET', url: `/runs/${jobId}/events` });
    expect(res.headers['content-type']).toContain('text/event-stream');

    const stepIndex = res.payload.indexOf('"type":"step:');
    const terminalIndex = res.payload.search(/"type":"run:(completed|failed)"/);
    expect(stepIndex).toBeGreaterThanOrEqual(0);
    expect(terminalIndex).toBeGreaterThan(stepIndex);
  });
});
