import { useState } from 'react';
import type { RunEvent, StepResult } from '@ai-native-testing/engine';
import type { FormState } from '../types';
import { deriveResults, type DerivedResults } from '../results';
import { fetchFlow } from '../flows';
import { fetchStep } from '../steps';
import { buildFlowDefinition } from '../dsl';
import { FlowResultsPanel, type TaskResult } from './FlowResultsPanel';

export interface FlowRunnerProps {
  flowNames: string[];
}

function taskStepCount(form: FormState): number {
  return 2 + form.extracts.length + form.questions.length;
}

export function FlowRunner({ flowNames }: FlowRunnerProps) {
  const [selectedFlow, setSelectedFlow] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [taskResults, setTaskResults] = useState<TaskResult[] | null>(null);

  async function handleRun() {
    setError(null);
    setTaskResults(null);

    const stepNames = await fetchFlow(selectedFlow);
    if (!stepNames || stepNames.length === 0) {
      setError('This flow has no steps to run.');
      return;
    }

    const fetchedForms = await Promise.all(stepNames.map((name) => fetchStep(name)));
    if (fetchedForms.some((form) => form === undefined)) {
      setError('Could not load one or more steps in this flow.');
      return;
    }
    const forms = fetchedForms as FormState[];

    const definition = buildFlowDefinition(forms);

    let jobId: string;
    try {
      const response = await fetch('/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(definition),
      });
      if (!response.ok) {
        const body = await response.json();
        setError(`Could not start flow run: ${JSON.stringify(body)}`);
        return;
      }
      const body = (await response.json()) as { jobId: string };
      jobId = body.jobId;
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const stepResults: (StepResult | undefined)[] = [];
    const boundaries: number[] = [];
    let offset = 0;
    for (const form of forms) {
      boundaries.push(offset);
      offset += taskStepCount(form);
    }

    function recomputeTaskResults() {
      const results: TaskResult[] = forms.map((form, taskIndex) => {
        const start = boundaries[taskIndex];
        const slice = stepResults.slice(start, start + taskStepCount(form));
        const variablesRecord = Object.fromEntries(
          form.variables.filter((row) => row.key.trim() !== '').map((row) => [row.key, row.value])
        );
        const derived: DerivedResults = deriveResults(form.extracts, variablesRecord, slice);
        const completedCount = slice.filter((r) => r !== undefined).length;
        let status: TaskResult['status'] = 'pending';
        if (completedCount === slice.length && slice.length > 0) {
          status = slice.every((r) => r?.status === 'passed') ? 'passed' : 'failed';
        } else if (slice.some((r) => r?.status === 'failed')) {
          status = 'failed';
        }
        return { name: form.taskName, status, results: derived };
      });
      setTaskResults(results);
    }

    recomputeTaskResults();

    const source = new EventSource(`/runs/${jobId}/events`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as RunEvent;
      if (event.type === 'step:completed' || event.type === 'step:failed') {
        stepResults[event.index] = event.result;
        recomputeTaskResults();
      }
      if (event.type === 'run:completed' || event.type === 'run:failed') {
        source.close();
      }
    };
    source.onerror = () => {
      setError('Connection lost — partial results shown below.');
      source.close();
    };
  }

  return (
    <section className="card">
      <h2 className="heading-md">E2E Flows</h2>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <label className="label">
        Flow
        <select
          className="text-input"
          value={selectedFlow}
          onChange={(e) => setSelectedFlow(e.target.value)}
        >
          <option value="" disabled>
            — Select a flow —
          </option>
          {flowNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn-primary" disabled={selectedFlow === ''} onClick={handleRun}>
        Run Flow
      </button>
      <FlowResultsPanel taskResults={taskResults} />
    </section>
  );
}
