import type { FormState } from '../types';
import { saveStep } from '../steps';

export interface SaveStepButtonProps {
  form: FormState;
  disabled: boolean;
  existingNames: string[];
  onSaved: (names: string[]) => void;
}

export function SaveStepButton({ form, disabled, existingNames, onSaved }: SaveStepButtonProps) {
  async function handleClick() {
    const input = window.prompt('Save as Reusable Step — enter a name:');
    if (input === null) {
      return;
    }
    const name = input.trim();
    if (name === '') {
      return;
    }
    if (existingNames.includes(name)) {
      const confirmed = window.confirm(`"${name}" already exists. Overwrite it?`);
      if (!confirmed) {
        return;
      }
    }
    const names = await saveStep(name, form);
    if (names) {
      onSaved(names);
      window.alert(`Saved "${name}".`);
    } else {
      window.alert('Could not save this step. Please try again.');
    }
  }

  return (
    <button type="button" className="btn-secondary" disabled={disabled} onClick={handleClick}>
      Save as Reusable Step
    </button>
  );
}
