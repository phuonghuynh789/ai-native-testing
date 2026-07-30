import type { FormState } from '../types';
import { fetchStep } from '../steps';

export interface LoadStepSelectProps {
  stepNames: string[];
  onLoad: (form: FormState) => void;
}

export function LoadStepSelect({ stepNames, onLoad }: LoadStepSelectProps) {
  return (
    <label className="label">
      Load Reusable Step
      <select
        className="text-input"
        defaultValue=""
        onChange={(e) => {
          const name = e.target.value;
          e.target.value = '';
          if (name === '') {
            return;
          }
          fetchStep(name).then((form) => {
            if (form) {
              onLoad(form);
            }
          });
        }}
      >
        <option value="" disabled>
          — Select a step —
        </option>
        {stepNames.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
