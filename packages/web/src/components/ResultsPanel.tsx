import { useState } from 'react';
import type { DerivedResults } from '../results';

type Tab = 'response' | 'savedValues' | 'context' | 'logs';

interface ResultsPanelProps {
  results: DerivedResults | null;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'response', label: 'Response' },
  { id: 'savedValues', label: 'Saved Values' },
  { id: 'context', label: 'Context' },
  { id: 'logs', label: 'Logs' },
];

function logLineClassName(line: string): string {
  if (line.includes('→ passed')) {
    return 'log-line log-line--passed';
  }
  if (line.includes('→ failed')) {
    return 'log-line log-line--failed';
  }
  return 'log-line log-line--muted';
}

export function ResultsPanel({ results }: ResultsPanelProps) {
  const [tab, setTab] = useState<Tab>('response');

  if (!results) {
    return <p className="body-strong">No run yet.</p>;
  }

  return (
    <section className="card">
      <nav className="tab-bar">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className="tab"
            aria-current={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'response' && (
        <div>
          {results.response ? (
            <>
              <p className="body-strong">Status: {results.response.status}</p>
              <pre className="code-block">{JSON.stringify(results.response.headers, null, 2)}</pre>
              <pre className="code-block">{JSON.stringify(results.response.body, null, 2)}</pre>
            </>
          ) : (
            <p className="body-strong">No response yet.</p>
          )}
        </div>
      )}
      {tab === 'savedValues' && (
        <pre className="code-block">{JSON.stringify(results.savedValues, null, 2)}</pre>
      )}
      {tab === 'context' && <pre className="code-block">{JSON.stringify(results.context, null, 2)}</pre>}
      {tab === 'logs' && (
        <ul className="log-list">
          {results.logs.map((line, index) => (
            <li key={index} className={logLineClassName(line)}>
              {line}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
