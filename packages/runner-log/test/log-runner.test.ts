import { describe, it, expect } from 'vitest';
import { RunContext } from '@ai-native-testing/engine';
import { LogRunner } from '../src/index.js';

describe('LogRunner', () => {
  const ctx = new RunContext();

  it('records a logged message', async () => {
    const runner = new LogRunner();
    await runner.interact('log', { message: 'hello' }, ctx);
    expect(runner.logs).toEqual(['hello']);
  });

  it('echoes back the given value', async () => {
    const runner = new LogRunner();
    const result = await runner.ask('echo', { value: 42 }, ctx);
    expect(result).toBe(42);
  });

  it('rejects an unknown interaction action', async () => {
    const runner = new LogRunner();
    await expect(runner.interact('unknown', {}, ctx)).rejects.toThrow(
      'LogRunner does not support interaction "unknown"'
    );
  });

  it('rejects an unknown question action', async () => {
    const runner = new LogRunner();
    await expect(runner.ask('unknown', {}, ctx)).rejects.toThrow(
      'LogRunner does not support question "unknown"'
    );
  });
});
