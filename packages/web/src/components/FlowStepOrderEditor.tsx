import { useState } from 'react';

export interface FlowStepOrderEditorProps {
  availableSteps: string[];
  flowOrder: string[];
  onFlowOrderChange: (next: string[]) => void;
}

function reorder(flowOrder: string[], draggedStep: string, dropIndex: number): string[] {
  const fromIndex = flowOrder.indexOf(draggedStep);
  const next = flowOrder.filter((name) => name !== draggedStep);
  let insertAt = dropIndex;
  if (fromIndex !== -1 && fromIndex < dropIndex) {
    insertAt -= 1;
  }
  next.splice(insertAt, 0, draggedStep);
  return next;
}

export function FlowStepOrderEditor({ availableSteps, flowOrder, onFlowOrderChange }: FlowStepOrderEditorProps) {
  const [draggedStep, setDraggedStep] = useState<string | null>(null);

  function handleDrop(dropIndex: number) {
    if (draggedStep === null) {
      return;
    }
    onFlowOrderChange(reorder(flowOrder, draggedStep, dropIndex));
    setDraggedStep(null);
  }

  return (
    <div className="flow-builder">
      <div className="card">
        <h3 className="heading-sm">All APIs</h3>
        <ul className="flow-step-list">
          {availableSteps.map((name) => (
            <li key={name} className="flow-step-row" draggable onDragStart={() => setDraggedStep(name)}>
              {name}
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h3 className="heading-sm">Flow Order</h3>
        <ul className="flow-step-list">
          {flowOrder.map((name, index) => (
            <li
              key={name}
              className="flow-step-row flow-step-row--ordered"
              draggable
              onDragStart={() => setDraggedStep(name)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(index)}
            >
              <span className="flow-step-index">{index + 1}</span>
              {name}
              <button
                type="button"
                className="flow-step-remove"
                aria-label={`Remove ${name} from flow`}
                onClick={() => onFlowOrderChange(flowOrder.filter((step) => step !== name))}
              >
                ✕
              </button>
            </li>
          ))}
          <li
            className="flow-step-row flow-step-row--dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(flowOrder.length)}
          >
            Drop here to add
          </li>
        </ul>
      </div>
    </div>
  );
}
