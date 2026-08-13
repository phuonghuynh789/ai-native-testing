import { useEffect, useState } from 'react';
import {
  fetchKafkaContractChecks,
  registerKafkaContractCheck,
  type KafkaContractCheckRow,
} from '../kafkaContractChecks';
import { KAFKA_TOPICS, type KafkaTopic } from '../types';

const POLL_INTERVAL_MS = 3000;

export function KafkaContractChecksPage() {
  const [rows, setRows] = useState<KafkaContractCheckRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [transidInput, setTransidInput] = useState('');
  const [topicInput, setTopicInput] = useState<KafkaTopic | ''>('');
  const [versionInput, setVersionInput] = useState('');
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [trackedMessageId, setTrackedMessageId] = useState<string | null>(null);

  useEffect(() => {
    fetchKafkaContractChecks().then(setRows);
    const id = setInterval(() => {
      fetchKafkaContractChecks().then(setRows);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  async function handleCheck() {
    if (transidInput.trim() === '' || topicInput === '' || versionInput.trim() === '') {
      return;
    }
    try {
      await registerKafkaContractCheck({
        message_id: transidInput,
        name: transidInput,
        topic: topicInput,
        version: versionInput,
      });
      setRegisterError(null);
      setTrackedMessageId(transidInput);
    } catch {
      setRegisterError('Could not register the Kafka contract check. Please try again.');
      setTrackedMessageId(null);
    }
  }

  const trackedRow = rows.find((r) => r.message_id === trackedMessageId);

  return (
    <main className="app-main">
      <h1 className="heading-xl">Kafka Contract Checks</h1>

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
        <label className="label">
          Version
          <input className="text-input" value={versionInput} onChange={(e) => setVersionInput(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn-primary"
          disabled={transidInput.trim() === '' || topicInput === '' || versionInput.trim() === ''}
          onClick={handleCheck}
        >
          Check Contract
        </button>
      </section>

      {trackedMessageId && (
        <section className="card">
          <h2 className="heading-md">Result</h2>
          {!trackedRow || trackedRow.status === 'pending' ? (
            <p className="body-strong">Pending…</p>
          ) : trackedRow.status === 'passed' ? (
            <p className="body-strong">PASSED</p>
          ) : trackedRow.status === 'error' ? (
            <>
              <p className="body-strong">ERROR</p>
              <p>{trackedRow.errorMessage}</p>
            </>
          ) : (
            <p className="body-strong">FAILED</p>
          )}
        </section>
      )}

      {rows.length === 0 && <p className="body-strong">No Kafka contract checks yet.</p>}
      <ul className="step-browser-list">
        {rows.map((row) => (
          <li key={row.message_id}>
            <button
              type="button"
              className="step-browser-row"
              onClick={() => setExpanded(expanded === row.message_id ? null : row.message_id)}
            >
              <span className="step-browser-name">{row.name}</span>
              <span className="step-browser-meta">
                {row.topic} · {row.version}
              </span>
              <span className="step-browser-flows">{row.status}</span>
            </button>
            {expanded === row.message_id && (
              <pre className="code-block">
                {row.status === 'error'
                  ? row.errorMessage
                  : row.diffReport
                    ? row.diffReport.findings
                        .map(
                          (f) =>
                            `${f.severity.toUpperCase()} ${f.kind} status=${f.status}${f.field ? ` field=${f.field}` : ''}`
                        )
                        .join('\n') || 'No differences found.'
                    : 'Pending…'}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
