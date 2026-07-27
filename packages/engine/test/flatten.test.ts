import { describe, it, expect } from 'vitest';
import { flattenSteps } from '../src/flatten.js';
import type { Step } from '../src/types.js';

describe('flattenSteps', () => {
  it('returns interaction and question steps unchanged when there is no nesting', () => {
    const steps: Step[] = [
      { type: 'interaction', runner: 'log', action: 'log', with: { message: 'hi' } },
      { type: 'question', runner: 'log', action: 'echo', with: { value: 1 }, expect: { equals: 1 } },
    ];
    expect(flattenSteps(steps)).toEqual(steps);
  });

  it('flattens a nested task step into its leaf steps, preserving order', () => {
    const inner1: Step = { type: 'interaction', runner: 'log', action: 'log', with: { message: 'a' } };
    const inner2: Step = { type: 'question', runner: 'log', action: 'echo', with: { value: 2 }, expect: { equals: 2 } };
    const steps: Step[] = [{ type: 'task', name: 'Nested', steps: [inner1, inner2] }];
    expect(flattenSteps(steps)).toEqual([inner1, inner2]);
  });

  it('flattens multiple levels of nested tasks', () => {
    const leaf: Step = { type: 'interaction', runner: 'log', action: 'log', with: { message: 'deep' } };
    const steps: Step[] = [
      { type: 'task', name: 'Outer', steps: [{ type: 'task', name: 'Inner', steps: [leaf] }] },
    ];
    expect(flattenSteps(steps)).toEqual([leaf]);
  });
});
