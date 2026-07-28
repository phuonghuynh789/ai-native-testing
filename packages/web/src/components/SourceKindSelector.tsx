import type { SourceKind } from '../types';

const SOURCE_KINDS: SourceKind[] = ['status', 'header', 'jsonPath'];

interface SourceKindSelectorProps {
  value: SourceKind;
  onChange: (value: SourceKind) => void;
  ariaLabel: string;
}

export function SourceKindSelector({ value, onChange, ariaLabel }: SourceKindSelectorProps) {
  return (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value as SourceKind)}>
      {SOURCE_KINDS.map((kind) => (
        <option key={kind} value={kind}>
          {kind}
        </option>
      ))}
    </select>
  );
}
