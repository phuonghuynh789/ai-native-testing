import { FlowRunner } from './FlowRunner';

export interface EndToEndTestPageProps {
  flowNames: string[];
  onFlowNamesChange: (flowNames: string[]) => void;
  stepNames: string[];
}

export function EndToEndTestPage({ flowNames, onFlowNamesChange, stepNames }: EndToEndTestPageProps) {
  return (
    <main className="app-main">
      <h1 className="heading-xl">End-to-end test</h1>
      <FlowRunner flowNames={flowNames} onFlowNamesChange={onFlowNamesChange} stepNames={stepNames} />
    </main>
  );
}
