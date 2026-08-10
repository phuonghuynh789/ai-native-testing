import { useEffect, useState } from 'react';
import { searchSteps, deleteStep, type StepSummary } from '../steps';
import { fetchFlowNames, fetchFlow } from '../flows';

export interface ManageStepsPageProps {
  stepNames: string[];
  onStepNamesChange: (names: string[]) => void;
  flowNames: string[];
  onFlowNamesChange: (names: string[]) => void;
}

const PAGE_SIZE = 20;

type Tab = 'steps' | 'flows';

export function ManageStepsPage({ onStepNamesChange }: ManageStepsPageProps) {
  const [tab, setTab] = useState<Tab>('steps');

  const [stepSearchInput, setStepSearchInput] = useState('');
  const [stepSearchTerm, setStepSearchTerm] = useState('');
  const [stepPage, setStepPage] = useState(1);
  const [stepItems, setStepItems] = useState<StepSummary[]>([]);
  const [stepTotal, setStepTotal] = useState(0);
  const [stepsError, setStepsError] = useState<string | null>(null);

  async function loadSteps(term: string, page: number) {
    const result = await searchSteps(term, page, PAGE_SIZE);
    setStepItems(result.items);
    setStepTotal(result.total);
  }

  useEffect(() => {
    loadSteps(stepSearchTerm, stepPage);
  }, [stepSearchTerm, stepPage]);

  function handleStepSearch() {
    setStepPage(1);
    setStepSearchTerm(stepSearchInput);
  }

  async function handleDeleteStep(name: string) {
    const allFlowNames = await fetchFlowNames();
    const referencingFlows: string[] = [];
    for (const flowName of allFlowNames) {
      const steps = await fetchFlow(flowName);
      if (steps?.includes(name)) {
        referencingFlows.push(flowName);
      }
    }

    const confirmed =
      referencingFlows.length > 0
        ? window.confirm(`Used by flows: ${referencingFlows.join(', ')}. Delete anyway?`)
        : window.confirm(`Delete '${name}'?`);
    if (!confirmed) {
      return;
    }

    const names = await deleteStep(name);
    if (names === undefined) {
      setStepsError(`Could not delete '${name}'. It may have already been removed.`);
      await loadSteps(stepSearchTerm, stepPage);
      return;
    }
    setStepsError(null);
    onStepNamesChange(names);

    const isLastRowOnPage = stepItems.length === 1 && stepPage > 1;
    if (isLastRowOnPage) {
      setStepPage(stepPage - 1);
    } else {
      await loadSteps(stepSearchTerm, stepPage);
    }
  }

  const stepTotalPages = Math.max(1, Math.ceil(stepTotal / PAGE_SIZE));

  return (
    <main className="app-main">
      <h1 className="heading-xl">Manage Load Reusable Step</h1>
      <div className="row">
        <button
          type="button"
          className={tab === 'steps' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setTab('steps')}
        >
          Steps
        </button>
        <button
          type="button"
          className={tab === 'flows' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setTab('flows')}
        >
          Flows
        </button>
      </div>

      {tab === 'steps' && (
        <section className="card">
          {stepsError && (
            <p role="alert" className="alert">
              {stepsError}
            </p>
          )}
          <label className="label">
            Reusable Step
            <input className="text-input" value={stepSearchInput} onChange={(e) => setStepSearchInput(e.target.value)} />
          </label>
          <button type="button" className="btn-secondary" onClick={handleStepSearch}>
            Search
          </button>

          {stepItems.length === 0 ? (
            <p className="field-hint">No reusable steps found.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Reusable Step</th>
                  <th>HTTP Verb</th>
                  <th>URL</th>
                  <th>Protocol</th>
                  <th>Service</th>
                  <th>Method</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {stepItems.map((item) => (
                  <tr key={item.name}>
                    <td>{item.name}</td>
                    <td>{item.protocol === 'rest' ? item.method : '—'}</td>
                    <td>{item.protocol === 'rest' ? item.url : '—'}</td>
                    <td>{item.protocol}</td>
                    <td>{item.protocol === 'grpc' ? item.grpcService : '—'}</td>
                    <td>{item.protocol === 'grpc' ? item.grpcMethod : '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="kv-remove"
                        aria-label={`Delete ${item.name}`}
                        onClick={() => handleDeleteStep(item.name)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="pagination">
            <button type="button" className="btn-secondary" disabled={stepPage <= 1} onClick={() => setStepPage(stepPage - 1)}>
              Prev
            </button>
            <span>
              Page {stepPage} of {stepTotalPages}
            </span>
            <button
              type="button"
              className="btn-secondary"
              disabled={stepPage >= stepTotalPages}
              onClick={() => setStepPage(stepPage + 1)}
            >
              Next
            </button>
          </div>
        </section>
      )}

      {tab === 'flows' && <div />}
    </main>
  );
}
