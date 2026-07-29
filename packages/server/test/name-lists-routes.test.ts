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
  dir = await mkdtemp(join(tmpdir(), 'name-lists-routes-'));
  return buildApp({ dataDir: dir });
}

describe('GET /actors', () => {
  it('returns an empty list when nothing has been saved yet', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/actors' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('POST /actors', () => {
  it('saves a new actor name and returns the updated list', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/actors', payload: { name: 'Customer' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ names: ['Customer'] });

    const list = await app.inject({ method: 'GET', url: '/actors' });
    expect(list.json()).toEqual(['Customer']);
  });

  it('rejects a blank name with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/actors', payload: { name: '  ' } });
    expect(res.statusCode).toBe(400);
  });

  it('does not duplicate an existing name', async () => {
    const app = await buildTestApp();
    await app.inject({ method: 'POST', url: '/actors', payload: { name: 'Customer' } });
    const res = await app.inject({ method: 'POST', url: '/actors', payload: { name: 'Customer' } });
    expect(res.json()).toEqual({ names: ['Customer'] });
  });
});

describe('GET /tasks and POST /tasks', () => {
  it('saves and lists a new task name', async () => {
    const app = await buildTestApp();
    await app.inject({ method: 'POST', url: '/tasks', payload: { name: 'Create Payment' } });
    const res = await app.inject({ method: 'GET', url: '/tasks' });
    expect(res.json()).toEqual(['Create Payment']);
  });

  it('rejects a blank name with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/tasks', payload: { name: '' } });
    expect(res.statusCode).toBe(400);
  });
});
