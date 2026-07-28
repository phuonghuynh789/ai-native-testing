import type { QuestionRow } from '../types';
import { SourceKindSelector } from './SourceKindSelector';

interface QuestionsEditorProps {
  rows: QuestionRow[];
  onChange: (rows: QuestionRow[]) => void;
}

export function QuestionsEditor({ rows, onChange }: QuestionsEditorProps) {
  function updateRow(id: string, patch: Partial<QuestionRow>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function removeRow(id: string) {
    onChange(rows.filter((row) => row.id !== id));
  }

  function addRow() {
    onChange([...rows, { id: crypto.randomUUID(), source: 'status', path: '', expected: '' }]);
  }

  return (
    <fieldset>
      <legend>Questions</legend>
      {rows.map((row) => (
        <div key={row.id}>
          <SourceKindSelector
            ariaLabel="Question source"
            value={row.source}
            onChange={(source) => updateRow(row.id, { source })}
          />
          {row.source !== 'status' && (
            <input
              aria-label="Question path"
              value={row.path}
              onChange={(e) => updateRow(row.id, { path: e.target.value })}
            />
          )}
          <input
            aria-label="Expected value"
            value={row.expected}
            onChange={(e) => updateRow(row.id, { expected: e.target.value })}
          />
          <button type="button" aria-label="Remove question row" onClick={() => removeRow(row.id)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={addRow}>
        Add question row
      </button>
    </fieldset>
  );
}
