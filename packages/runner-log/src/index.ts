import type { Runner, RunContext } from '@ai-native-testing/engine';

export class LogRunner implements Runner {
  name = 'log';
  public readonly logs: string[] = [];

  async interact(action: string, args: Record<string, unknown>, _ctx: RunContext): Promise<void> {
    if (action !== 'log') {
      throw new Error(`LogRunner does not support interaction "${action}"`);
    }
    this.logs.push(String(args.message));
  }

  async ask(action: string, args: Record<string, unknown>, _ctx: RunContext): Promise<unknown> {
    if (action !== 'echo') {
      throw new Error(`LogRunner does not support question "${action}"`);
    }
    return args.value;
  }
}
