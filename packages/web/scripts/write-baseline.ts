import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunCaptureResult } from './baseline-capture-core.js';

const DEFAULT_BASELINES_DIR = join(process.cwd(), 'kafka-baselines');

export async function writeBaseline(
  result: RunCaptureResult,
  options: { version: string; allowOverwrite: boolean; baselinesDir?: string }
): Promise<string> {
  const baselinesDir = options.baselinesDir ?? DEFAULT_BASELINES_DIR;
  const versionDir = join(baselinesDir, options.version);
  const filePath = join(versionDir, `${result.status}.json`);

  if (!options.allowOverwrite) {
    const exists = await access(filePath).then(
      () => true,
      () => false
    );
    if (exists) {
      throw new Error(
        `Baseline already exists at ${filePath}. Use update-baseline.ts to intentionally overwrite it.`
      );
    }
  }

  await mkdir(versionDir, { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        version: options.version,
        status: result.status,
        durationMs: result.durationMs,
        messages: result.messages,
      },
      null,
      2
    )
  );
  return filePath;
}
