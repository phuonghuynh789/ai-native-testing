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

describe('StepStore.delete', () => {
  it('deletes an existing step and returns the updated names list', async () => {
    const store = new StepStore(join(dir, 'steps.json'));
    await store.save('Create Payment', { method: 'POST' });
    await store.save('Get Payment', { method: 'GET' });
    const names = await store.delete('Create Payment');
    expect(names).toEqual(['Get Payment']);
    expect(await store.get('Create Payment')).toBeUndefined();
  });

  it('returns undefined when deleting an unknown name', async () => {
    const store = new StepStore(join(dir, 'steps.json'));
    expect(await store.delete('Missing')).toBeUndefined();
  });

  it('persists the deletion across separate store instances pointed at the same file', async () => {
    const filePath = join(dir, 'steps.json');
    const first = new StepStore(filePath);
    await first.save('Login', { method: 'POST' });
    await first.delete('Login');

    const second = new StepStore(filePath);
    expect(await second.list()).toEqual([]);
  });
});

describe('StepStore.search', () => {
  it('matches step names case-insensitively by substring', async () => {
    const store = new StepStore(join(dir, 'steps.json'));
    await store.save('Create Payment', { protocol: 'rest', method: 'POST', url: 'https://x.com' });
    await store.save('Get Payment Status', { protocol: 'rest', method: 'GET', url: 'https://x.com/status' });
    await store.save('Login', { protocol: 'rest', method: 'POST', url: 'https://x.com/login' });

    const result = await store.search('payment', 1, 20);
    expect(result.total).toBe(2);
    expect(result.items.map((i) => i.name).sort()).toEqual(['Create Payment', 'Get Payment Status']);
  });

  it('paginates results and reports the total match count', async () => {
    const store = new StepStore(join(dir, 'steps.json'));
    for (let i = 1; i <= 25; i++) {
      await store.save(`Step ${String(i).padStart(2, '0')}`, { protocol: 'rest' });
    }
    const page1 = await store.search('', 1, 20);
    expect(page1.items).toHaveLength(20);
    expect(page1.total).toBe(25);

    const page2 = await store.search('', 2, 20);
    expect(page2.items).toHaveLength(5);
    expect(page2.total).toBe(25);
  });

  it('extracts REST and gRPC summary fields correctly', async () => {
    const store = new StepStore(join(dir, 'steps.json'));
    await store.save('REST Step', { protocol: 'rest', method: 'POST', url: 'https://x.com/y' });
    await store.save('gRPC Step', { protocol: 'grpc', grpc: { service: 'UserSvc', method: 'Create' } });

    const result = await store.search('', 1, 20);
    const rest = result.items.find((i) => i.name === 'REST Step');
    const grpc = result.items.find((i) => i.name === 'gRPC Step');
    expect(rest).toEqual({
      name: 'REST Step',
      protocol: 'rest',
      method: 'POST',
      url: 'https://x.com/y',
      grpcService: '',
      grpcMethod: '',
    });
    expect(grpc).toEqual({
      name: 'gRPC Step',
      protocol: 'grpc',
      method: '',
      url: '',
      grpcService: 'UserSvc',
      grpcMethod: 'Create',
    });
  });

  it('defensively handles malformed or missing fields without throwing', async () => {
    const store = new StepStore(join(dir, 'steps.json'));
    await store.save('Weird Step', {});
    const result = await store.search('', 1, 20);
    expect(result.items[0]).toEqual({
      name: 'Weird Step',
      protocol: '',
      method: '',
      url: '',
      grpcService: '',
      grpcMethod: '',
    });
  });
});
