import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NameListStore } from '../src/name-list-store.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'name-list-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('NameListStore', () => {
  it('returns an empty list and creates the file when it does not exist yet', async () => {
    const store = new NameListStore(join(dir, 'actors.json'));
    expect(await store.list()).toEqual([]);

    const contents = await readFile(join(dir, 'actors.json'), 'utf8');
    expect(JSON.parse(contents)).toEqual([]);
  });

  it('adds a name and returns the updated list', async () => {
    const store = new NameListStore(join(dir, 'actors.json'));
    const result = await store.add('Authenticated Customer');
    expect(result).toEqual(['Authenticated Customer']);
    expect(await store.list()).toEqual(['Authenticated Customer']);
  });

  it('does not add a duplicate name', async () => {
    const store = new NameListStore(join(dir, 'actors.json'));
    await store.add('Admin');
    const result = await store.add('Admin');
    expect(result).toEqual(['Admin']);
  });

  it('persists across separate store instances pointed at the same file', async () => {
    const filePath = join(dir, 'actors.json');
    const first = new NameListStore(filePath);
    await first.add('Customer');

    const second = new NameListStore(filePath);
    expect(await second.list()).toEqual(['Customer']);
  });

  it('creates a nested data directory if it does not exist yet', async () => {
    const store = new NameListStore(join(dir, 'nested', 'actors.json'));
    await store.add('Customer');
    expect(await store.list()).toEqual(['Customer']);
  });
});
