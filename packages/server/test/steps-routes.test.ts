import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';

let dir: string | undefined;

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

async function buildTestApp() {
  dir = await mkdtemp(join(tmpdir(), 'steps-routes-'));
  return buildApp({ dataDir: dir });
}

describe('GET /steps', () => {
  it('returns an empty list when nothing has been saved yet', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/steps' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('POST /steps', () => {
  it('saves a step and returns the updated names list', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/steps',
      payload: { name: 'Create Payment', content: { method: 'POST', url: 'https://api.example.com/x' } },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ names: ['Create Payment'] });
  });

  it('rejects a blank name with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/steps',
      payload: { name: '  ', content: { method: 'GET' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects missing content with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/steps', payload: { name: 'Create Payment' } });
    expect(res.statusCode).toBe(400);
  });

  it('overwrites content when saving under an existing name', async () => {
    const app = await buildTestApp();
    await app.inject({
      method: 'POST',
      url: '/steps',
      payload: { name: 'Create Payment', content: { method: 'POST' } },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/steps',
      payload: { name: 'Create Payment', content: { method: 'PUT' } },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ names: ['Create Payment'] });
  });
});

describe('GET /steps/:name', () => {
  it('returns the saved content', async () => {
    const app = await buildTestApp();
    await app.inject({
      method: 'POST',
      url: '/steps',
      payload: { name: 'Create Payment', content: { method: 'POST', url: 'https://api.example.com/x' } },
    });
    const res = await app.inject({ method: 'GET', url: '/steps/Create%20Payment' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ method: 'POST', url: 'https://api.example.com/x' });
  });

  it('returns 404 for an unknown name', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/steps/Missing' });
    expect(res.statusCode).toBe(404);
  });
});
