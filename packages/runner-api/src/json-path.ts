export function extractJsonPath(value: unknown, path: string): unknown {
  const segments = parsePath(path);
  let current: unknown = value;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      throw new Error(`JSONPath "${path}" could not be resolved: reached ${String(current)} at "${segment}"`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (current === undefined) {
    throw new Error(`JSONPath "${path}" did not resolve to a value`);
  }
  return current;
}

function parsePath(path: string): string[] {
  if (!path.startsWith('$')) {
    throw new Error(`JSONPath "${path}" must start with "$"`);
  }
  const rest = path.slice(1);
  const segments: string[] = [];
  const regex = /\.([^.[\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  while ((match = regex.exec(rest)) !== null) {
    if (match.index !== lastIndex) {
      throw new Error(`JSONPath "${path}" is malformed near "${rest.slice(lastIndex)}"`);
    }
    segments.push((match[1] ?? match[2]) as string);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex !== rest.length) {
    throw new Error(`JSONPath "${path}" is malformed near "${rest.slice(lastIndex)}"`);
  }
  return segments;
}
