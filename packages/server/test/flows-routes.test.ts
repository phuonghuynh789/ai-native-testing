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
  dir = await mkdtemp(join(tmpdir(), 'flows-routes-'));
  return buildApp({ dataDir: dir });
}

describe('GET /flows', () => {
  it('returns an empty list when nothing has been saved yet', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/flows' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('POST /flows', () => {
  it('creates a new flow with one step and returns the updated flow names', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/flows',
      payload: { flowName: 'Transfer money by wallet', stepName: 'Check Balance' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ names: ['Transfer money by wallet'] });
  });

  it('appends to an existing flow', async () => {
    const app = await buildTestApp();
    await app.inject({
      method: 'POST',
      url: '/flows',
      payload: { flowName: 'Transfer money by wallet', stepName: 'Check Balance' },
    });
    await app.inject({
      method: 'POST',
      url: '/flows',
      payload: { flowName: 'Transfer money by wallet', stepName: 'Transfer Money' },
    });
    const res = await app.inject({ method: 'GET', url: '/flows/Transfer%20money%20by%20wallet' });
    expect(res.json()).toEqual(['Check Balance', 'Transfer Money']);
  });

  it('rejects a blank flowName with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/flows',
      payload: { flowName: '  ', stepName: 'Check Balance' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a blank stepName with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/flows',
      payload: { flowName: 'Transfer money by wallet', stepName: '' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /flows/:name', () => {
  it('returns 404 for an unknown flow', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/flows/Missing' });
    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /flows/:name', () => {
  it("replaces the flow's step list and returns the updated flow names", async () => {
    const app = await buildTestApp();
    await app.inject({
      method: 'POST',
      url: '/flows',
      payload: { flowName: 'Transfer money by wallet', stepName: 'Check Balance' },
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/flows/Transfer%20money%20by%20wallet',
      payload: { stepNames: ['Transfer Money', 'Check Balance'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ names: ['Transfer money by wallet'] });

    const getRes = await app.inject({ method: 'GET', url: '/flows/Transfer%20money%20by%20wallet' });
    expect(getRes.json()).toEqual(['Transfer Money', 'Check Balance']);
  });

  it('creates a new flow if it does not exist yet', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/flows/Brand%20New%20Flow',
      payload: { stepNames: ['Login'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ names: ['Brand New Flow'] });
  });

  it('rejects a non-array stepNames with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/flows/Some%20Flow',
      payload: { stepNames: 'not-an-array' },
    });
    expect(res.statusCode).toBe(400);
  });
});
