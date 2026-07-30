import { useState } from 'react';
import type { DerivedResults } from '../results';
import { ResultsPanel } from './ResultsPanel';

export interface TaskResult {
  name: string;
  status: 'pending' | 'passed' | 'failed';
  results: DerivedResults;
}

export interface FlowResultsPanelProps {
  taskResults: TaskResult[] | null;
}

function statusClassName(status: TaskResult['status']): string {
  if (status === 'passed') {
    return 'log-line log-line--passed';
  }
  if (status === 'failed') {
    return 'log-line log-line--failed';
  }
  return 'log-line log-line--muted';
}

export function FlowResultsPanel({ taskResults }: FlowResultsPanelProps) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (!taskResults) {
    return <p className="body-strong">No flow run yet.</p>;
  }

  return (
    <ul className="log-list">
      {taskResults.map((task, index) => (
        <li key={index}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setExpanded(expanded === index ? null : index)}
          >
            <span className={statusClassName(task.status)}>
              {task.name} — {task.status}
              {task.results.response ? ` (Status: ${task.results.response.status})` : ''}
            </span>
          </button>
          {expanded === index && <ResultsPanel results={task.results} />}
        </li>
      ))}
    </ul>
  );
}
