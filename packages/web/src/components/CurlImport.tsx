import { useState } from 'react';
import type { KeyValueRow } from '../types';
import { parseCurl } from '../curl';

export interface CurlImportResult {
  method: string;
  url: string;
  headers: KeyValueRow[];
  body: string;
}

export interface CurlImportProps {
  onImport: (result: CurlImportResult) => void;
}

export function CurlImport({ onImport }: CurlImportProps) {
  const [text, setText] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  function handleImport() {
    const result = parseCurl(text);
    if (result.ok) {
      onImport({ method: result.method, url: result.url, headers: result.headers, body: result.body });
      setMessage({ type: 'success', text: 'Imported.' });
    } else {
      setMessage({ type: 'error', text: result.error });
    }
  }

  return (
    <fieldset className="card">
      <legend className="heading-sm">Paste cURL</legend>
      <label className="label">
        cURL command
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
      {message && (
        <p className={message.type === 'error' ? 'alert' : 'alert alert--success'}>{message.text}</p>
      )}
    </fieldset>
  );
}
