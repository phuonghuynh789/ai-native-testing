import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FlowStore } from '../src/flow-store.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'flow-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FlowStore', () => {
  it('returns an empty list and creates the file when it does not exist yet', async () => {
    const store = new FlowStore(join(dir, 'flows.json'));
    expect(await store.list()).toEqual([]);

    const contents = await readFile(join(dir, 'flows.json'), 'utf8');
    expect(JSON.parse(contents)).toEqual({});
  });

  it('creates a new flow with one step', async () => {
    const store = new FlowStore(join(dir, 'flows.json'));
    const names = await store.addStep('Transfer money by wallet', 'Check Balance');
    expect(names).toEqual(['Transfer money by wallet']);
    expect(await store.get('Transfer money by wallet')).toEqual(['Check Balance']);
  });

  it('appends to an existing flow, preserving order', async () => {
    const store = new FlowStore(join(dir, 'flows.json'));
    await store.addStep('Transfer money by wallet', 'Check Balance');
    await store.addStep('Transfer money by wallet', 'Transfer Money');
    const names = await store.addStep('Transfer money by wallet', 'Confirm Transfer');
    expect(names).toEqual(['Transfer money by wallet']);
    expect(await store.get('Transfer money by wallet')).toEqual([
      'Check Balance',
      'Transfer Money',
      'Confirm Transfer',
    ]);
  });

  it('returns undefined for an unknown flow', async () => {
    const store = new FlowStore(join(dir, 'flows.json'));
    expect(await store.get('Missing')).toBeUndefined();
  });

  it('persists across separate store instances pointed at the same file', async () => {
    const filePath = join(dir, 'flows.json');
    const first = new FlowStore(filePath);
    await first.addStep('Login Flow', 'Login');

    const second = new FlowStore(filePath);
    expect(await second.list()).toEqual(['Login Flow']);
    expect(await second.get('Login Flow')).toEqual(['Login']);
  });

  it('creates a nested data directory if it does not exist yet', async () => {
    const store = new FlowStore(join(dir, 'nested', 'flows.json'));
    await store.addStep('Login Flow', 'Login');
    expect(await store.list()).toEqual(['Login Flow']);
  });
});
