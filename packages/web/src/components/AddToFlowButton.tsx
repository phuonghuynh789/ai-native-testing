import { useState } from 'react';
import { addStepToFlow } from '../flows';

export interface AddToFlowButtonProps {
  stepNames: string[];
  flowNames: string[];
  onAdded: (flowNames: string[]) => void;
}

const NEW_FLOW_OPTION = '__new_flow__';

export function AddToFlowButton({ stepNames, flowNames, onAdded }: AddToFlowButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedStep, setSelectedStep] = useState('');
  const [selectedFlow, setSelectedFlow] = useState('');
  const [newFlowName, setNewFlowName] = useState('');

  function resolvedFlowName(): string {
    return selectedFlow === NEW_FLOW_OPTION ? newFlowName.trim() : selectedFlow;
  }

  function reset() {
    setSelectedStep('');
    setSelectedFlow('');
    setNewFlowName('');
  }

  async function handleAdd() {
    const flowName = resolvedFlowName();
    const names = await addStepToFlow(flowName, selectedStep);
    if (names) {
      onAdded(names);
      reset();
      setIsOpen(false);
    } else {
      window.alert('Could not add this step to the flow. Please try again.');
    }
  }

  if (!isOpen) {
    return (
      <button type="button" className="btn-secondary" onClick={() => setIsOpen(true)}>
        Add to E2E Flow
      </button>
    );
  }

  const canAdd = selectedStep !== '' && resolvedFlowName() !== '';

  return (
    <fieldset className="card">
      <legend className="heading-sm">Add to E2E Flow</legend>
      <label className="label">
        Step
        <select
          className="text-input"
          value={selectedStep}
          onChange={(e) => setSelectedStep(e.target.value)}
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
      <label className="label">
        Flow
        <select
          className="text-input"
          value={selectedFlow}
          onChange={(e) => setSelectedFlow(e.target.value)}
        >
          <option value="" disabled>
            — Select a flow —
          </option>
          {flowNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          <option value={NEW_FLOW_OPTION}>+ New Flow</option>
        </select>
      </label>
      {selectedFlow === NEW_FLOW_OPTION && (
        <label className="label">
          New flow name
          <input
            className="text-input"
            value={newFlowName}
            onChange={(e) => setNewFlowName(e.target.value)}
          />
        </label>
      )}
      <div className="row">
        <button type="button" className="btn-primary" disabled={!canAdd} onClick={handleAdd}>
          Add
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            reset();
            setIsOpen(false);
          }}
        >
          Cancel
        </button>
      </div>
    </fieldset>
  );
}
