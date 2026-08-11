import { useEffect, useState } from 'react';
import { fetchKafkaChecks, registerKafkaCheck, type KafkaCheckRow } from '../kafkaChecks';
import { KAFKA_TOPICS, type KafkaTopic } from '../types';

const POLL_INTERVAL_MS = 3000;

export function KafkaChecksPage() {
  const [rows, setRows] = useState<KafkaCheckRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [transidInput, setTransidInput] = useState('');
  const [topicInput, setTopicInput] = useState<KafkaTopic | ''>('');
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [trackedMessageId, setTrackedMessageId] = useState<string | null>(null);

  useEffect(() => {
    fetchKafkaChecks().then(setRows);
    const id = setInterval(() => {
      fetchKafkaChecks().then(setRows);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  async function handleCheckKafka() {
    if (transidInput.trim() === '' || topicInput === '') {
      return;
    }
    try {
      await registerKafkaCheck({ message_id: transidInput, name: transidInput, topic: topicInput });
      setRegisterError(null);
      setTrackedMessageId(transidInput);
    } catch {
      setRegisterError('Could not register the Kafka check. Please try again.');
      setTrackedMessageId(null);
    }
  }

  const trackedRow = rows.find((r) => r.message_id === trackedMessageId);

  return (
    <main className="app-main">
      <h1 className="heading-xl">Check Kafka</h1>

      <section className="card">
        {registerError && (
          <p role="alert" className="alert">
            {registerError}
          </p>
        )}
        <label className="label">
          Transaction ID
          <input className="text-input" value={transidInput} onChange={(e) => setTransidInput(e.target.value)} />
        </label>
        <label className="label">
          Kafka Topic
          <select
            className="text-input"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value as KafkaTopic | '')}
          >
            <option value="" disabled>
              — Select a topic —
            </option>
            {KAFKA_TOPICS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn-primary"
          disabled={transidInput.trim() === '' || topicInput === ''}
          onClick={handleCheckKafka}
        >
          Check Kafka
        </button>
      </section>

      {trackedMessageId && (
        <section className="card">
          <h2 className="heading-md">Result</h2>
          {!trackedRow || trackedRow.status === 'pending' || trackedRow.status === 'received' ? (
            <p className="body-strong">Pending…</p>
          ) : trackedRow.status === 'passed' ? (
            <p className="body-strong">PASSED</p>
          ) : (
            <>
              <p className="body-strong">FAILED</p>
              <p>Missing fields: {trackedRow.missingFields.join(', ')}</p>
            </>
          )}
        </section>
      )}

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
