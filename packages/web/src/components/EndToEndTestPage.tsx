import { FlowRunner } from './FlowRunner';

export interface EndToEndTestPageProps {
  flowNames: string[];
}

export function EndToEndTestPage({ flowNames }: EndToEndTestPageProps) {
  return (
    <main className="app-main">
      <h1 className="heading-xl">End-to-end test</h1>
      <FlowRunner flowNames={flowNames} />
    </main>
  );
}
