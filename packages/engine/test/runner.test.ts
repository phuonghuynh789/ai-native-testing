import { describe, it, expect } from 'vitest';
import { RunnerRegistry, type Runner } from '../src/runner.js';
import { RunContext } from '../src/context.js';

function makeStubRunner(name: string): Runner {
  return {
    name,
    async interact() {},
    async ask() {
      return null;
    },
  };
}

describe('RunnerRegistry', () => {
  it('registers and retrieves a runner by name', () => {
    const registry = new RunnerRegistry();
    const runner = makeStubRunner('log');
    registry.register(runner);
    expect(registry.get('log')).toBe(runner);
  });

  it('throws when getting an unregistered runner name', () => {
    const registry = new RunnerRegistry();
    expect(() => registry.get('missing')).toThrow('No runner registered with name "missing"');
  });

  it('passes a RunContext instance through to runner methods', async () => {
    const ctx = new RunContext();
    let received: RunContext | undefined;
    const runner: Runner = {
      name: 'probe',
      async interact(_action, _args, runCtx) {
        received = runCtx;
      },
      async ask() {
        return null;
      },
    };
    await runner.interact('noop', {}, ctx);
    expect(received).toBe(ctx);
  });
});
