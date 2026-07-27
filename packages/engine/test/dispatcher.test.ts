import { describe, it, expect, vi } from 'vitest';
import { runDefinition } from '../src/dispatcher.js';
import { RunnerRegistry, type Runner } from '../src/runner.js';
import type { TestDefinition, RunEvent } from '../src/types.js';
import type { EventEmitter } from 'node:events';

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
});
