import type { RunContext } from './context.js';

export interface Runner {
  name: string;
  interact(action: string, args: Record<string, unknown>, ctx: RunContext): Promise<void>;
  ask(action: string, args: Record<string, unknown>, ctx: RunContext): Promise<unknown>;
}

export class RunnerRegistry {
  private runners = new Map<string, Runner>();

  register(runner: Runner): void {
    this.runners.set(runner.name, runner);
  }

  get(name: string): Runner {
    const runner = this.runners.get(name);
    if (!runner) {
      throw new Error(`No runner registered with name "${name}"`);
    }
    return runner;
  }
}
