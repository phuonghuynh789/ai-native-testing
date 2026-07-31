import { useState } from 'react';
import type { KeyValueRow } from '../types';
import { parseGrpcurl } from '../grpcurl';

export interface PasteGrpcurlPanelResult {
  serverAddress: string;
  service: string;
  method: string;
  message: string;
  metadata: KeyValueRow[];
}

export interface PasteGrpcurlPanelProps {
  onImport: (result: PasteGrpcurlPanelResult) => void;
}

export function PasteGrpcurlPanel({ onImport }: PasteGrpcurlPanelProps) {
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  function handleImport() {
    const result = parseGrpcurl(text);
    if (result.ok) {
      onImport({
        serverAddress: result.serverAddress,
        service: result.service,
        method: result.method,
        message: result.message,
        metadata: result.metadata,
      });
      setFeedback({ type: 'success', text: 'Imported.' });
    } else {
      setFeedback({ type: 'error', text: result.error });
    }
  }

  return (
    <fieldset className="card">
      <legend className="heading-sm">Paste grpcurl</legend>
      <label className="label">
        grpcurl command
        <textarea className="code-input" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <button
        type="button"
        className="btn-secondary"
        disabled={text.trim() === ''}
        onClick={handleImport}
      >
        Import
      </button>
      {feedback && (
        <p className={feedback.type === 'error' ? 'alert' : 'alert alert--success'}>{feedback.text}</p>
      )}
    </fieldset>
  );
}
