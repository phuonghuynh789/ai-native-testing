export class RunContext {
  private variables = new Map<string, unknown>();

  remember(name: string, value: unknown): void {
    this.variables.set(name, value);
  }

  get(name: string): unknown {
    return this.variables.get(name);
  }

  resolve<T>(value: T): T {
    return this.resolveValue(value) as T;
  }

  private resolveValue(value: unknown): unknown {
    if (typeof value === 'string') {
      const match = /^\$\{(\w+)\}$/.exec(value);
      if (match) {
        return this.variables.get(match[1]);
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.resolveValue(item));
    }
    if (value !== null && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        result[key] = this.resolveValue(val);
      }
      return result;
    }
    return value;
  }
}
