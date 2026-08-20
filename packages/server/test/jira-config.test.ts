import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadJiraConfig } from '../src/jira-config.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jira-config-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadJiraConfig', () => {
  it('parses baseUrl and token from yaml', async () => {
    const filePath = join(dir, 'jira.yaml');
    await writeFile(filePath, 'baseUrl: https://jira.zalopay.vn\ntoken: my-token\n');
    const config = loadJiraConfig(filePath);
    expect(config).toEqual({ baseUrl: 'https://jira.zalopay.vn', token: 'my-token' });
  });

  it('returns undefined when the file does not exist', () => {
    expect(loadJiraConfig(join(dir, 'missing.yaml'))).toBeUndefined();
  });
});
