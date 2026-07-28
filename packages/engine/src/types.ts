export interface Actor {
  name: string;
  abilities: string[];
}

export interface InteractionStep {
  type: 'interaction';
  runner: string;
  action: string;
  with?: Record<string, unknown>;
}

export interface QuestionStep {
  type: 'question';
  runner: string;
  action: string;
  with?: Record<string, unknown>;
  expect: { equals: unknown };
  remember?: string;
}

export interface TaskStep {
  type: 'task';
  name: string;
  steps: Step[];
}

export interface ExtractStep {
  type: 'extract';
  runner: string;
  action: string;
  with?: Record<string, unknown>;
  remember: string;
}

export type Step = InteractionStep | QuestionStep | TaskStep | ExtractStep;
export type LeafStep = InteractionStep | QuestionStep | ExtractStep;

export interface TaskDefinition {
  name: string;
  steps: Step[];
}

export interface TestDefinition {
  actor: Actor;
  tasks: TaskDefinition[];
  variables?: Record<string, unknown>;
}

export interface StepResult {
  type: 'interaction' | 'question' | 'extract';
  runner: string;
  action: string;
  status: 'pending' | 'passed' | 'failed' | 'skipped';
  args?: Record<string, unknown>;
  actual?: unknown;
  expected?: unknown;
  error?: string;
}

export type RunEvent =
  | { type: 'step:started'; index: number; step: LeafStep }
  | { type: 'step:completed'; index: number; result: StepResult }
  | { type: 'step:failed'; index: number; result: StepResult }
  | { type: 'run:completed' }
  | { type: 'run:failed'; error: string };
