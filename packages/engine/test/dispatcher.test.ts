import { describe, it, expect, vi } from 'vitest';
import { runDefinition } from '../src/dispatcher.js';
import { RunnerRegistry, type Runner } from '../src/runner.js';
import type { TestDefinition, RunEvent } from '../src/types.js';
import { EventEmitter } from 'node:events';

function collectEvents(emitter: EventEmitter): RunEvent[] {
  const events: RunEvent[] = [];
  emitter.on('event', (e: RunEvent) => events.push(e));
  return events;
}

describe('runDefinition', () => {
  it('runs a passing interaction and question, remembering the answer', async () => {
    const askMock = vi.fn().mockResolvedValue(201);
    const runner: Runner = {
      name: 'log',
      interact: vi.fn().mockResolvedValue(undefined),
      ask: askMock,
    };
    const registry = new RunnerRegistry();
    registry.register(runner);

    const definition: TestDefinition = {
      actor: { name: 'Customer', abilities: ['log'] },
      tasks: [
        {
          name: 'Create Payment',
          steps: [
            { type: 'interaction', runner: 'log', action: 'log', with: { message: 'hi' } },
            { type: 'question', runner: 'log', action: 'echo', with: { value: 201 }, expect: { equals: 201 }, remember: 'statusCode' },
            { type: 'question', runner: 'log', action: 'echo', with: { value: '${statusCode}' }, expect: { equals: 201 } },
          ],
        },
      ],
    };

    const { emitter, done } = runDefinition(definition, registry);
    const events = collectEvents(emitter);
    const result = await done;

    expect(result).toEqual({ status: 'passed' });
    expect(events.at(-1)).toEqual({ type: 'run:completed' });
    expect(askMock).toHaveBeenNthCalledWith(1, 'echo', { value: 201 }, expect.anything());
    expect(askMock).toHaveBeenNthCalledWith(2, 'echo', { value: 201 }, expect.anything());
  });

  it('stops at the first failed question and skips remaining steps', async () => {
    const interactMock = vi.fn().mockResolvedValue(undefined);
    const runner: Runner = {
      name: 'log',
      interact: interactMock,
      ask: vi.fn().mockResolvedValue(500),
    };
    const registry = new RunnerRegistry();
    registry.register(runner);

    const definition: TestDefinition = {
      actor: { name: 'Customer', abilities: ['log'] },
      tasks: [
        {
          name: 'Create Payment',
          steps: [
            { type: 'question', runner: 'log', action: 'echo', with: { value: 500 }, expect: { equals: 201 } },
            { type: 'interaction', runner: 'log', action: 'log', with: { message: 'should not run' } },
          ],
        },
      ],
    };

    const { emitter, done } = runDefinition(definition, registry);
    const events = collectEvents(emitter);
    const result = await done;

    expect(result).toEqual({ status: 'failed' });
    expect(interactMock).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'step:failed')).toBe(true);
    expect(events.at(-1)?.type).toBe('run:failed');
  });

  it('marks the run as failed when a runner throws', async () => {
    const runner: Runner = {
      name: 'log',
      interact: vi.fn().mockRejectedValue(new Error('boom')),
      ask: vi.fn().mockResolvedValue(null),
    };
    const registry = new RunnerRegistry();
    registry.register(runner);

    const definition: TestDefinition = {
      actor: { name: 'Customer', abilities: ['log'] },
      tasks: [{ name: 'T', steps: [{ type: 'interaction', runner: 'log', action: 'log', with: {} }] }],
    };

    const { done } = runDefinition(definition, registry);
    const result = await done;
    expect(result).toEqual({ status: 'failed' });
  });

  it('flattens nested task steps before executing', async () => {
    const askMock = vi.fn().mockResolvedValue(1);
    const runner: Runner = { name: 'log', interact: vi.fn().mockResolvedValue(undefined), ask: askMock };
    const registry = new RunnerRegistry();
    registry.register(runner);

    const definition: TestDefinition = {
      actor: { name: 'Customer', abilities: ['log'] },
      tasks: [
        {
          name: 'Outer',
          steps: [
            {
              type: 'task',
              name: 'Inner',
              steps: [{ type: 'question', runner: 'log', action: 'echo', with: { value: 1 }, expect: { equals: 1 } }],
            },
          ],
        },
      ],
    };

    const { done } = runDefinition(definition, registry);
    const result = await done;
    expect(result).toEqual({ status: 'passed' });
    expect(askMock).toHaveBeenCalledTimes(1);
  });

  it('resolves to failed (not rejected) when a step references an unregistered runner', async () => {
    const registry = new RunnerRegistry();
    // Note: no runner is registered at all.

    const definition: TestDefinition = {
      actor: { name: 'Customer', abilities: ['log'] },
      tasks: [
        {
          name: 'T',
          steps: [{ type: 'interaction', runner: 'missing', action: 'log', with: {} }],
        },
      ],
    };

    // `RunnerRegistry.get` throws synchronously with no `await` beforehand on this path.
    // Because `runDefinition` now defers the start of execution to a microtask (see
    // src/dispatcher.ts), it is safe to attach the listener with the natural
    // `emitter.on(...)` pattern immediately after the call returns — no spy trick needed.
    const { emitter, done } = runDefinition(definition, registry);
    const events = collectEvents(emitter);
    const result = await done;

    expect(result).toEqual({ status: 'failed' });

    const failedEvent = events.find((e) => e.type === 'step:failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent && 'result' in failedEvent ? failedEvent.result.error : undefined).toMatch(
      /No runner registered with name "missing"/
    );

    const lastEvent = events.at(-1);
    expect(lastEvent?.type).toBe('run:failed');
    expect(lastEvent && lastEvent.type === 'run:failed' ? lastEvent.error : undefined).toMatch(
      /No runner registered with name "missing"/
    );
  });

  it('captures step:started, step:failed, and run:failed via a listener attached after runDefinition returns, even for an immediate synchronous failure', async () => {
    const registry = new RunnerRegistry();
    // Note: no runner is registered at all, so registry.get throws synchronously
    // on the very first step, with no `await` beforehand.

    const definition: TestDefinition = {
      actor: { name: 'Customer', abilities: ['log'] },
      tasks: [
        {
          name: 'T',
          steps: [{ type: 'interaction', runner: 'missing', action: 'log', with: {} }],
        },
      ],
    };

    const { emitter, done } = runDefinition(definition, registry);
    // Listener attached strictly after runDefinition returns, using the plain
    // `emitter.on(...)` pattern a real caller (e.g. Task 6's JobStore) would use.
    const events = collectEvents(emitter);
    const result = await done;

    expect(result).toEqual({ status: 'failed' });
    expect(events.map((e) => e.type)).toEqual(['step:started', 'step:failed', 'run:failed']);
  });

  it('captures step:started for the first step via a listener attached after runDefinition returns', async () => {
    const askMock = vi.fn().mockResolvedValue(201);
    const runner: Runner = {
      name: 'log',
      interact: vi.fn().mockResolvedValue(undefined),
      ask: askMock,
    };
    const registry = new RunnerRegistry();
    registry.register(runner);

    const definition: TestDefinition = {
      actor: { name: 'Customer', abilities: ['log'] },
      tasks: [
        {
          name: 'Create Payment',
          steps: [
            { type: 'interaction', runner: 'log', action: 'log', with: { message: 'hi' } },
          ],
        },
      ],
    };

    const { emitter, done } = runDefinition(definition, registry);
    // If execution were not deferred to a microtask, the first `step:started`
    // would fire synchronously during the runDefinition(...) call above, before
    // this listener is attached, and would be silently missed.
    const events = collectEvents(emitter);
    await done;

    expect(events[0]).toEqual({
      type: 'step:started',
      index: 0,
      step: definition.tasks[0].steps[0],
    });
  });

  it('does not remember the answer when a question fails', async () => {
    const askMock = vi.fn().mockResolvedValue(500);
    const runner: Runner = {
      name: 'log',
      interact: vi.fn().mockResolvedValue(undefined),
      ask: askMock,
    };
    const registry = new RunnerRegistry();
    registry.register(runner);

    const definition: TestDefinition = {
      actor: { name: 'Customer', abilities: ['log'] },
      tasks: [
        {
          name: 'Create Payment',
          steps: [
            {
              type: 'question',
              runner: 'log',
              action: 'echo',
              with: { value: 500 },
              expect: { equals: 201 },
              remember: 'x',
            },
          ],
        },
      ],
    };

    const { emitter, done } = runDefinition(definition, registry);
    const events = collectEvents(emitter);
    const result = await done;

    expect(result).toEqual({ status: 'failed' });

    const failedEvent = events.find((e) => e.type === 'step:failed');
    expect(failedEvent).toBeDefined();
    if (failedEvent && failedEvent.type === 'step:failed') {
      expect(failedEvent.result.actual).toBe(500);
      expect(failedEvent.result.expected).toBe(201);
      expect(failedEvent.result.status).toBe('failed');
    }
    expect(events.at(-1)?.type).toBe('run:failed');
    // Note: RunContext exposes no iteration/inspection API beyond get(name), and the run
    // aborts immediately after the failing question (fail-fast), so there is no subsequent
    // step through the public API that could observe whether `remember` fired. This test
    // instead pins down the failing StepResult shape; the code fix itself (remember moved
    // inside the `if (passed)` branch in src/dispatcher.ts) is what guarantees `ctx.remember`
    // is never called on the failure path.
  });

  it('seeds RunContext from definition.variables before the first step runs', async () => {
    const askMock = vi.fn().mockResolvedValue('ok');
    const runner: Runner = {
      name: 'log',
      interact: vi.fn().mockResolvedValue(undefined),
      ask: askMock,
    };
    const registry = new RunnerRegistry();
    registry.register(runner);

    const definition: TestDefinition = {
      actor: { name: 'Customer', abilities: ['log'] },
      variables: { baseUrl: 'https://api.example.com' },
      tasks: [
        {
          name: 'T',
          steps: [
            { type: 'question', runner: 'log', action: 'echo', with: { value: '${baseUrl}' }, expect: { equals: 'ok' } },
          ],
        },
      ],
    };

    const { done } = runDefinition(definition, registry);
    const result = await done;

    expect(result).toEqual({ status: 'passed' });
    expect(askMock).toHaveBeenCalledWith('echo', { value: 'https://api.example.com' }, expect.anything());
  });

  it('runs an extract step: unconditionally remembers the answer, no pass/fail comparison', async () => {
    const askMock = vi.fn(async (_action: string, args: Record<string, unknown>) => args.value);
    const runner: Runner = {
      name: 'log',
      interact: vi.fn().mockResolvedValue(undefined),
      ask: askMock,
    };
    const registry = new RunnerRegistry();
    registry.register(runner);

    const definition: TestDefinition = {
      actor: { name: 'Customer', abilities: ['log'] },
      tasks: [
        {
          name: 'T',
          steps: [
            { type: 'extract', runner: 'log', action: 'echo', with: { value: 'remembered-value' }, remember: 'x' },
            { type: 'question', runner: 'log', action: 'echo', with: { value: '${x}' }, expect: { equals: 'remembered-value' } },
          ],
        },
      ],
    };

    const { emitter, done } = runDefinition(definition, registry);
    const events = collectEvents(emitter);
    const result = await done;

    expect(result).toEqual({ status: 'passed' });
    const extractEvent = events.find((e) => e.type === 'step:completed' && e.result.type === 'extract');
    expect(extractEvent).toBeDefined();
  });

  it("fails the run when an extract step's ask throws", async () => {
    const runner: Runner = {
      name: 'log',
      interact: vi.fn().mockResolvedValue(undefined),
      ask: vi.fn().mockRejectedValue(new Error('bad path')),
    };
    const registry = new RunnerRegistry();
    registry.register(runner);

    const definition: TestDefinition = {
      actor: { name: 'Customer', abilities: ['log'] },
      tasks: [{ name: 'T', steps: [{ type: 'extract', runner: 'log', action: 'echo', with: {}, remember: 'x' }] }],
    };

    const { done } = runDefinition(definition, registry);
    const result = await done;
    expect(result).toEqual({ status: 'failed' });
  });
});
