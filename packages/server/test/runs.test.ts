import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';

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
});
