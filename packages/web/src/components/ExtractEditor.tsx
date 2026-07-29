import type { ExtractRow } from '../types';
import { SourceKindSelector } from './SourceKindSelector';

interface ExtractEditorProps {
  rows: ExtractRow[];
  onChange: (rows: ExtractRow[]) => void;
}

export function ExtractEditor({ rows, onChange }: ExtractEditorProps) {
  function updateRow(id: string, patch: Partial<ExtractRow>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function removeRow(id: string) {
    onChange(rows.filter((row) => row.id !== id));
  }

  function addRow() {
    onChange([...rows, { id: crypto.randomUUID(), source: 'jsonPath', path: '', rememberAs: '' }]);
  }

  return (
    <fieldset className="card">
      <legend className="heading-sm">Extract</legend>
      {rows.map((row) => (
        <div key={row.id} className="row">
          <SourceKindSelector
            ariaLabel="Extract source"
            value={row.source}
            onChange={(source) => updateRow(row.id, { source })}
          />
          {row.source !== 'status' && (
            <input
              className="text-input"
              aria-label="Extract path"
              value={row.path}
              onChange={(e) => updateRow(row.id, { path: e.target.value })}
            />
          )}
          <input
            className="text-input"
            aria-label="Remember as"
            value={row.rememberAs}
            onChange={(e) => updateRow(row.id, { rememberAs: e.target.value })}
          />
          <button
            type="button"
            className="btn-secondary"
            aria-label="Remove extract row"
            onClick={() => removeRow(row.id)}
          >
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn-secondary" onClick={addRow}>
        Add extract row
      </button>
    </fieldset>
  );
}
