import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StepStore } from '../src/step-store.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'step-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('StepStore', () => {
  it('returns an empty list and creates the file when it does not exist yet', async () => {
    const store = new StepStore(join(dir, 'steps.json'));
    expect(await store.list()).toEqual([]);

    const contents = await readFile(join(dir, 'steps.json'), 'utf8');
    expect(JSON.parse(contents)).toEqual({});
  });

  it('saves and retrieves content by name', async () => {
    const store = new StepStore(join(dir, 'steps.json'));
    const names = await store.save('Create Payment', {
      method: 'POST',
      url: 'https://api.example.com/x',
    });
    expect(names).toEqual(['Create Payment']);
    expect(await store.get('Create Payment')).toEqual({
      method: 'POST',
      url: 'https://api.example.com/x',
    });
  });

  it('returns undefined for an unknown name', async () => {
    const store = new StepStore(join(dir, 'steps.json'));
    expect(await store.get('Missing')).toBeUndefined();
  });

  it('overwrites content when saving under an existing name', async () => {
    const store = new StepStore(join(dir, 'steps.json'));
    await store.save('Create Payment', { method: 'POST' });
    const names = await store.save('Create Payment', { method: 'PUT' });
    expect(names).toEqual(['Create Payment']);
    expect(await store.get('Create Payment')).toEqual({ method: 'PUT' });
  });

  it('persists across separate store instances pointed at the same file', async () => {
    const filePath = join(dir, 'steps.json');
    const first = new StepStore(filePath);
    await first.save('Login', { method: 'POST' });

    const second = new StepStore(filePath);
    expect(await second.list()).toEqual(['Login']);
    expect(await second.get('Login')).toEqual({ method: 'POST' });
  });

  it('creates a nested data directory if it does not exist yet', async () => {
    const store = new StepStore(join(dir, 'nested', 'steps.json'));
    await store.save('Login', { method: 'POST' });
    expect(await store.list()).toEqual(['Login']);
  });
});
