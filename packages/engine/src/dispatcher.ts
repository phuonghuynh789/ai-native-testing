import { EventEmitter } from 'node:events';
import { RunContext } from './context.js';
import type { RunnerRegistry } from './runner.js';
import { flattenSteps } from './flatten.js';
import type { TestDefinition, StepResult, RunEvent, LeafStep } from './types.js';

export interface RunHandle {
  emitter: EventEmitter;
  done: Promise<{ status: 'passed' | 'failed' }>;
}

export function runDefinition(definition: TestDefinition, registry: RunnerRegistry): RunHandle {
  const emitter = new EventEmitter();
  const ctx = new RunContext();
  const steps = definition.tasks.flatMap((task) => flattenSteps(task.steps));

  const done = executeSteps(steps, ctx, registry, emitter);

  return { emitter, done };
}

async function executeSteps(
  steps: LeafStep[],
  ctx: RunContext,
  registry: RunnerRegistry,
  emitter: EventEmitter
): Promise<{ status: 'passed' | 'failed' }> {
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    emitter.emit('event', { type: 'step:started', index, step } satisfies RunEvent);

    const runner = registry.get(step.runner);
    const args = ctx.resolve(step.with ?? {});

    try {
      if (step.type === 'interaction') {
        await runner.interact(step.action, args, ctx);
        const result: StepResult = {
          type: 'interaction',
          runner: step.runner,
          action: step.action,
          status: 'passed',
          args,
        };
        emitter.emit('event', { type: 'step:completed', index, result } satisfies RunEvent);
      } else {
        const actual = await runner.ask(step.action, args, ctx);
        const expected = ctx.resolve(step.expect.equals);
        const passed = actual === expected;
        if (step.remember) {
          ctx.remember(step.remember, actual);
        }
        const result: StepResult = {
          type: 'question',
          runner: step.runner,
          action: step.action,
          status: passed ? 'passed' : 'failed',
          args,
          actual,
          expected,
        };
        if (passed) {
          emitter.emit('event', { type: 'step:completed', index, result } satisfies RunEvent);
        } else {
          emitter.emit('event', { type: 'step:failed', index, result } satisfies RunEvent);
          emitter.emit('event', {
            type: 'run:failed',
            error: `Question "${step.action}" failed: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
          } satisfies RunEvent);
          return { status: 'failed' };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const result: StepResult = {
        type: step.type,
        runner: step.runner,
        action: step.action,
        status: 'failed',
        args,
        error: message,
      };
      emitter.emit('event', { type: 'step:failed', index, result } satisfies RunEvent);
      emitter.emit('event', { type: 'run:failed', error: message } satisfies RunEvent);
      return { status: 'failed' };
    }
  }

  emitter.emit('event', { type: 'run:completed' } satisfies RunEvent);
  return { status: 'passed' };
}
