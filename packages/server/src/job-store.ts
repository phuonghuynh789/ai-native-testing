import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  runDefinition,
  flattenSteps,
  type TestDefinition,
  type StepResult,
  type RunEvent,
  type RunnerRegistry,
} from '@ai-native-testing/engine';

export interface JobState {
  jobId: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  steps: StepResult[];
  createdAt: string;
  finishedAt?: string;
}

export class JobStore {
  private jobs = new Map<string, JobState>();
  private emitters = new Map<string, EventEmitter>();
  private history = new Map<string, RunEvent[]>();

  createJob(definition: TestDefinition, registry: RunnerRegistry): string {
    const jobId = randomUUID();
    const steps: StepResult[] = definition.tasks
      .flatMap((task) => flattenSteps(task.steps))
      .map((step) => ({
        type: step.type,
        runner: step.runner,
        action: step.action,
        status: 'pending' as const,
      }));

    const job: JobState = {
      jobId,
      status: 'running',
      steps,
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(jobId, job);
    this.history.set(jobId, []);

    const jobEmitter = new EventEmitter();
    this.emitters.set(jobId, jobEmitter);

    const { emitter, done } = runDefinition(definition, registry);

    emitter.on('event', (event: RunEvent) => {
      this.history.get(jobId)!.push(event);
      this.applyEvent(job, event);
      jobEmitter.emit('event', event);
    });

    // `job.status`/`finishedAt` are derived from the `run:completed`/`run:failed`
    // events above (applied synchronously, before subscribers are notified), not
    // from this `done` promise: `done` resolves in a later microtask than the
    // 'event' listener runs, so any subscriber awaiting the terminal event (as
    // `waitForFinish` does in tests) would still observe `status: 'running'` if
    // we set it here instead. `done` cannot reject under normal operation
    // (the dispatcher catches all step errors internally), but this `.catch` is
    // kept as a defensive guard against an unhandled rejection.
    done.catch(() => {});

    return jobId;
  }

  getJob(jobId: string): JobState | undefined {
    return this.jobs.get(jobId);
  }

  getHistory(jobId: string): RunEvent[] {
    return this.history.get(jobId) ?? [];
  }

  subscribe(jobId: string, listener: (event: RunEvent) => void): () => void {
    const emitter = this.emitters.get(jobId);
    if (!emitter) {
      return () => {};
    }
    emitter.on('event', listener);
    return () => emitter.off('event', listener);
  }

  private applyEvent(job: JobState, event: RunEvent): void {
    switch (event.type) {
      case 'step:completed':
      case 'step:failed':
        job.steps[event.index] = event.result;
        break;
      case 'run:completed':
        job.status = 'passed';
        job.finishedAt = new Date().toISOString();
        break;
      case 'run:failed':
        job.status = 'failed';
        job.finishedAt = new Date().toISOString();
        for (const step of job.steps) {
          if (step.status === 'pending') {
            step.status = 'skipped';
          }
        }
        break;
    }
  }
}
