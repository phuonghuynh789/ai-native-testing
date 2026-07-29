import type { KeyValueRow } from '../types';

interface KeyValueRowsProps {
  label: string;
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
}

export function KeyValueRows({ label, rows, onChange }: KeyValueRowsProps) {
  function updateRow(id: string, field: 'key' | 'value', value: string) {
    onChange(rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  }

  function removeRow(id: string) {
    onChange(rows.filter((row) => row.id !== id));
  }

  function addRow() {
    onChange([...rows, { id: crypto.randomUUID(), key: '', value: '' }]);
  }

  return (
    <fieldset className="card">
      <legend className="heading-sm">{label}</legend>
      {rows.map((row) => (
        <div key={row.id} className="row">
          <input
            className="text-input"
            aria-label={`${label} key`}
            value={row.key}
            onChange={(e) => updateRow(row.id, 'key', e.target.value)}
          />
          <input
            className="text-input"
            aria-label={`${label} value`}
            value={row.value}
            onChange={(e) => updateRow(row.id, 'value', e.target.value)}
          />
          <button
            type="button"
            className="btn-secondary"
            aria-label={`Remove ${label} row`}
            onClick={() => removeRow(row.id)}
          >
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn-secondary" onClick={addRow}>
        Add {label} row
      </button>
    </fieldset>
  );
}
