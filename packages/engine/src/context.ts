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
      const wholeMatch = /^\$\{(\w+)\}$/.exec(value);
      if (wholeMatch) {
        return this.variables.get(wholeMatch[1]);
      }
      if (/\$\{\w+\}/.test(value)) {
        return value.replace(/\$\{(\w+)\}/g, (_full, name: string) => String(this.variables.get(name)));
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
