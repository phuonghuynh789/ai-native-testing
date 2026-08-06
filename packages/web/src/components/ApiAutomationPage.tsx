import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RunEvent, StepResult } from '@ai-native-testing/engine';
import type { FormState } from '../types';
import { fetchStep } from '../steps';
import { fetchFlow } from '../flows';
import { buildTestDefinition, buildTaskSteps, rowsToRecord } from '../dsl';
import { deriveResults } from '../results';
import { FlowResultsPanel, type TaskResult } from './FlowResultsPanel';

export interface ApiAutomationPageProps {
  stepNames: string[];
  flowNames: string[];
  onFormChange: Dispatch<SetStateAction<FormState>>;
}

interface GrpcStepEntry {
  name: string;
  form: FormState;
  flows: string[];
}

function matches(value: string, filter: string): boolean {
  return value.toLowerCase().includes(filter.toLowerCase());
}

function toVariablesRecord(form: FormState): Record<string, string> {
  return rowsToRecord(form.variables);
}

export function ApiAutomationPage({ stepNames, flowNames, onFormChange }: ApiAutomationPageProps) {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<GrpcStepEntry[]>([]);
  const [serviceFilter, setServiceFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [flowFilter, setFlowFilter] = useState('');
  const [taskResults, setTaskResults] = useState<TaskResult[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const fetchedSteps = await Promise.all(
        stepNames.map(async (name) => ({ name, form: await fetchStep(name) }))
      );
      const fetchedFlows = await Promise.all(
        flowNames.map(async (flowName) => ({ flowName, stepsInFlow: (await fetchFlow(flowName)) ?? [] }))
      );

      if (cancelled) {
        return;
      }

      const grpcEntries = fetchedSteps
        .filter((step): step is { name: string; form: FormState } => step.form?.protocol === 'grpc')
        .map(({ name, form }) => ({
          name,
          form,
          flows: fetchedFlows.filter(({ stepsInFlow }) => stepsInFlow.includes(name)).map(({ flowName }) => flowName),
        }));

      setEntries(grpcEntries);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [stepNames, flowNames]);

  const serviceOptions = Array.from(new Set(entries.map((entry) => entry.form.grpc.service))).filter(Boolean);
  const methodOptions = Array.from(
    new Set(
      entries
        .filter((entry) => matches(entry.form.grpc.service, serviceFilter))
        .map((entry) => entry.form.grpc.method)
    )
  ).filter(Boolean);

  const filteredEntries = entries.filter(
    (entry) =>
      matches(entry.form.grpc.service, serviceFilter) &&
      matches(entry.form.grpc.method, methodFilter) &&
      (flowFilter === '' || entry.flows.some((flowName) => matches(flowName, flowFilter)))
  );

  const isRunning = taskResults !== null && taskResults.some((result) => result.status === 'pending');

  function handleRowClick(entry: GrpcStepEntry) {
    onFormChange(entry.form);
    navigate('/');
  }

  function updateTaskResult(index: number, result: TaskResult) {
    setTaskResults((prev) => {
      if (!prev) {
        return prev;
      }
      const next = [...prev];
      next[index] = result;
      return next;
    });
  }

  function runEntry(entry: GrpcStepEntry, index: number) {
    const variablesRecord = toVariablesRecord(entry.form);
    const totalSteps = buildTaskSteps(entry.form).length;
    const stepResults: (StepResult | undefined)[] = [];

    function recompute() {
      const completedCount = stepResults.filter((result) => result !== undefined).length;
      let status: TaskResult['status'] = 'pending';
      if (completedCount === totalSteps) {
        status = stepResults.every((result) => result?.status === 'passed') ? 'passed' : 'failed';
      } else if (stepResults.some((result) => result?.status === 'failed')) {
        status = 'failed';
      }
      updateTaskResult(index, {
        name: entry.name,
        status,
        results: deriveResults(entry.form.extracts, entry.form.afterResponse, variablesRecord, stepResults),
      });
    }

    async function start() {
      let jobId: string;
      try {
        const response = await fetch('/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildTestDefinition(entry.form)),
        });
        if (!response.ok) {
          updateTaskResult(index, {
            name: entry.name,
            status: 'failed',
            results: deriveResults(entry.form.extracts, entry.form.afterResponse, variablesRecord, []),
          });
          return;
        }
        const body = (await response.json()) as { jobId: string };
        jobId = body.jobId;
      } catch {
        updateTaskResult(index, {
          name: entry.name,
          status: 'failed',
          results: deriveResults(entry.form.extracts, entry.form.afterResponse, variablesRecord, []),
        });
        return;
      }

      const source = new EventSource(`/runs/${jobId}/events`);
      source.onmessage = (message) => {
        const event = JSON.parse(message.data) as RunEvent;
        if (event.type === 'step:completed' || event.type === 'step:failed') {
          stepResults[event.index] = event.result;
          recompute();
        }
        if (event.type === 'run:completed' || event.type === 'run:failed') {
          source.close();
        }
      };
      source.onerror = () => {
        source.close();
      };
    }

    start();
  }

  function handleRun() {
    setTaskResults(
      filteredEntries.map((entry) => ({
        name: entry.name,
        status: 'pending',
        results: deriveResults(entry.form.extracts, entry.form.afterResponse, toVariablesRecord(entry.form), []),
      }))
    );
    filteredEntries.forEach((entry, index) => runEntry(entry, index));
  }

  return (
    <main className="app-main">
      <h1 className="heading-xl">API Automation</h1>
      <div className="row">
        <label className="label">
          Service
          <input
            className="text-input"
            list="api-automation-service-options"
            value={serviceFilter}
            onChange={(e) => {
              setServiceFilter(e.target.value);
              setTaskResults(null);
            }}
          />
          <datalist id="api-automation-service-options">
            {serviceOptions.map((service) => (
              <option key={service} value={service} />
            ))}
          </datalist>
        </label>
        <label className="label">
          Method
          <input
            className="text-input"
            list="api-automation-method-options"
            value={methodFilter}
            onChange={(e) => {
              setMethodFilter(e.target.value);
              setTaskResults(null);
            }}
          />
          <datalist id="api-automation-method-options">
            {methodOptions.map((method) => (
              <option key={method} value={method} />
            ))}
          </datalist>
        </label>
        <label className="label">
          E2E flow
          <input
            className="text-input"
            list="api-automation-flow-options"
            value={flowFilter}
            onChange={(e) => {
              setFlowFilter(e.target.value);
              setTaskResults(null);
            }}
          />
          <datalist id="api-automation-flow-options">
            {flowNames.map((flowName) => (
              <option key={flowName} value={flowName} />
            ))}
          </datalist>
        </label>
      </div>
      <div className="row">
        <button
          type="button"
          className="btn-primary"
          disabled={filteredEntries.length === 0 || isRunning}
          onClick={handleRun}
        >
          Run
        </button>
      </div>
      <ul className="step-browser-list">
        {filteredEntries.map((entry) => (
          <li key={entry.name}>
            <button type="button" className="step-browser-row" onClick={() => handleRowClick(entry)}>
              <span className="step-browser-name">{entry.name}</span>
              <span className="step-browser-meta">
                {entry.form.grpc.service} / {entry.form.grpc.method}
              </span>
              <span className="step-browser-flows">{entry.flows.length > 0 ? entry.flows.join(', ') : '—'}</span>
            </button>
          </li>
        ))}
      </ul>
      <FlowResultsPanel taskResults={taskResults} />
    </main>
  );
}
