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

export function ResultsPanel({ results }: ResultsPanelProps) {
  const [tab, setTab] = useState<Tab>('response');

  if (!results) {
    return <p>No run yet.</p>;
  }

  return (
    <section>
      <nav>
        {TABS.map(({ id, label }) => (
          <button key={id} type="button" aria-current={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      {tab === 'response' && (
        <div>
          {results.response ? (
            <>
              <p>Status: {results.response.status}</p>
              <pre>{JSON.stringify(results.response.headers, null, 2)}</pre>
              <pre>{JSON.stringify(results.response.body, null, 2)}</pre>
            </>
          ) : (
            <p>No response yet.</p>
          )}
        </div>
      )}
      {tab === 'savedValues' && <pre>{JSON.stringify(results.savedValues, null, 2)}</pre>}
      {tab === 'context' && <pre>{JSON.stringify(results.context, null, 2)}</pre>}
      {tab === 'logs' && (
        <ul>
          {results.logs.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
