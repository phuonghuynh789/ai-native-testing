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

  it("replaces an existing flow's steps via setSteps", async () => {
    const store = new FlowStore(join(dir, 'flows.json'));
    await store.addStep('Transfer money by wallet', 'Check Balance');
    await store.addStep('Transfer money by wallet', 'Transfer Money');

    const names = await store.setSteps('Transfer money by wallet', ['Transfer Money', 'Check Balance']);
    expect(names).toEqual(['Transfer money by wallet']);
    expect(await store.get('Transfer money by wallet')).toEqual(['Transfer Money', 'Check Balance']);
  });

  it('creates a new flow via setSteps if it does not exist yet', async () => {
    const store = new FlowStore(join(dir, 'flows.json'));
    const names = await store.setSteps('Brand New Flow', ['Login', 'Check Balance']);
    expect(names).toEqual(['Brand New Flow']);
    expect(await store.get('Brand New Flow')).toEqual(['Login', 'Check Balance']);
  });
});

describe('FlowStore.delete', () => {
  it('deletes an existing flow and returns the updated names list', async () => {
    const store = new FlowStore(join(dir, 'flows.json'));
    await store.setSteps('Checkout', ['Login', 'Create Payment']);
    await store.setSteps('Refund', ['Login', 'Refund Payment']);
    const names = await store.delete('Checkout');
    expect(names).toEqual(['Refund']);
    expect(await store.get('Checkout')).toBeUndefined();
  });

  it('returns undefined when deleting an unknown name', async () => {
    const store = new FlowStore(join(dir, 'flows.json'));
    expect(await store.delete('Missing')).toBeUndefined();
  });

  it('persists the deletion across separate store instances pointed at the same file', async () => {
    const filePath = join(dir, 'flows.json');
    const first = new FlowStore(filePath);
    await first.setSteps('Checkout', ['Login']);
    await first.delete('Checkout');

    const second = new FlowStore(filePath);
    expect(await second.list()).toEqual([]);
  });
});

describe('FlowStore.search', () => {
  it('matches flow names case-insensitively by substring and includes their steps', async () => {
    const store = new FlowStore(join(dir, 'flows.json'));
    await store.setSteps('Checkout Flow', ['Login', 'Create Payment']);
    await store.setSteps('Refund Flow', ['Login', 'Refund Payment']);
    await store.setSteps('Onboarding', ['Create Account']);

    const result = await store.search('flow', 1, 20);
    expect(result.total).toBe(2);
    expect(result.items.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'Checkout Flow', steps: ['Login', 'Create Payment'] },
      { name: 'Refund Flow', steps: ['Login', 'Refund Payment'] },
    ]);
  });

  it('paginates results and reports the total match count', async () => {
    const store = new FlowStore(join(dir, 'flows.json'));
    for (let i = 1; i <= 25; i++) {
      await store.setSteps(`Flow ${String(i).padStart(2, '0')}`, []);
    }
    const page1 = await store.search('', 1, 20);
    expect(page1.items).toHaveLength(20);
    expect(page1.total).toBe(25);

    const page2 = await store.search('', 2, 20);
    expect(page2.items).toHaveLength(5);
    expect(page2.total).toBe(25);
  });
});
