import type { Step, LeafStep } from './types.js';

export function flattenSteps(steps: Step[]): LeafStep[] {
  const result: LeafStep[] = [];
  for (const step of steps) {
    if (step.type === 'task') {
      result.push(...flattenSteps(step.steps));
    } else {
      result.push(step);
    }
  }
  return result;
}
