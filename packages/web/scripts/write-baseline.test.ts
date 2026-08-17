import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeBaseline } from './write-baseline.js';
import type { RunCaptureResult } from './baseline-capture-core.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kafka-baselines-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function result(overrides: Partial<RunCaptureResult> = {}): RunCaptureResult {
  return { status: 'SUCCESS', durationMs: 1000, messages: [{ a: 1 }], ...overrides };
}

describe('writeBaseline', () => {
  it('writes a new baseline file at kafka-baselines/{topic}/{version}/{status}.json', async () => {
    const path = await writeBaseline(result(), {
      topic: 'transLogV1',
      version: 'v1',
      allowOverwrite: false,
      baselinesDir: dir,
    });
    expect(path).toBe(join(dir, 'transLogV1', 'v1', 'SUCCESS.json'));
    const written = JSON.parse(await readFile(path, 'utf8'));
    expect(written.status).toBe('SUCCESS');
    expect(written.version).toBe('v1');
    expect(written.messages).toEqual([{ a: 1 }]);
    expect(typeof written.capturedAt).toBe('string');
  });

  it('keeps two topics using the same version independent', async () => {
    await writeBaseline(result({ messages: [{ topic: 'transLogV1' }] }), {
      topic: 'transLogV1',
      version: 'v1',
      allowOverwrite: false,
      baselinesDir: dir,
    });
    await writeBaseline(result({ messages: [{ topic: 'refundLog' }] }), {
      topic: 'refundLog',
      version: 'v1',
      allowOverwrite: false,
      baselinesDir: dir,
    });

    const transLogWritten = JSON.parse(await readFile(join(dir, 'transLogV1', 'v1', 'SUCCESS.json'), 'utf8'));
    const refundLogWritten = JSON.parse(await readFile(join(dir, 'refundLog', 'v1', 'SUCCESS.json'), 'utf8'));
    expect(transLogWritten.messages).toEqual([{ topic: 'transLogV1' }]);
    expect(refundLogWritten.messages).toEqual([{ topic: 'refundLog' }]);
  });

  it('refuses to overwrite an existing baseline when allowOverwrite is false', async () => {
    await writeBaseline(result(), { topic: 'transLogV1', version: 'v1', allowOverwrite: false, baselinesDir: dir });
    await expect(
      writeBaseline(result(), { topic: 'transLogV1', version: 'v1', allowOverwrite: false, baselinesDir: dir })
    ).rejects.toThrow(/already exists/i);
  });

  it('overwrites an existing baseline when allowOverwrite is true', async () => {
    await writeBaseline(result(), { topic: 'transLogV1', version: 'v1', allowOverwrite: false, baselinesDir: dir });
    await writeBaseline(result({ durationMs: 2000 }), {
      topic: 'transLogV1',
      version: 'v1',
      allowOverwrite: true,
      baselinesDir: dir,
    });
    const path = join(dir, 'transLogV1', 'v1', 'SUCCESS.json');
    const written = JSON.parse(await readFile(path, 'utf8'));
    expect(written.durationMs).toBe(2000);
  });
});
