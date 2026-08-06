import { useEffect, useState } from 'react';
import { fetchKafkaChecks, type KafkaCheckRow } from '../kafkaChecks';

const POLL_INTERVAL_MS = 3000;

export function KafkaChecksPage() {
  const [rows, setRows] = useState<KafkaCheckRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetchKafkaChecks().then(setRows);
    const id = setInterval(() => {
      fetchKafkaChecks().then(setRows);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="app-main">
      <h1 className="heading-xl">Check Kafka</h1>
      {rows.length === 0 && <p className="body-strong">No Kafka checks yet.</p>}
      <ul className="step-browser-list">
        {rows.map((row) => (
          <li key={row.message_id}>
            <button
              type="button"
              className="step-browser-row"
              onClick={() => setExpanded(expanded === row.message_id ? null : row.message_id)}
            >
              <span className="step-browser-name">{row.name}</span>
              <span className="step-browser-meta">{row.topic}</span>
              <span className="step-browser-flows">{row.status}</span>
            </button>
            {expanded === row.message_id && (
              <pre className="code-block">
                {row.missingFields.length > 0
                  ? `Missing fields: ${row.missingFields.join(', ')}`
                  : JSON.stringify(row.matchedMessage, null, 2)}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
