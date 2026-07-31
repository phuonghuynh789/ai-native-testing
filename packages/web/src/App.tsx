import { useEffect, useState } from 'react';
import type { RunEvent, StepResult } from '@ai-native-testing/engine';
import type { FormState } from './types';
import { deriveResults, type DerivedResults } from './results';
import { fetchNames, saveName } from './nameLists';
import { fetchStepNames } from './steps';
import { fetchFlowNames } from './flows';
import { ScreenplayHeader } from './components/ScreenplayHeader';
import { KeyValueRows } from './components/KeyValueRows';
import { RequestBuilder } from './components/RequestBuilder';
import { RunButton } from './components/RunButton';
import { ResultsPanel } from './components/ResultsPanel';
import { SaveStepButton } from './components/SaveStepButton';
import { LoadStepSelect } from './components/LoadStepSelect';
import { AddToFlowButton } from './components/AddToFlowButton';
import { FlowRunner } from './components/FlowRunner';

function initialForm(): FormState {
  return {
    actorName: '',
    taskName: '',
    variables: [],
    protocol: 'rest',
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    grpc: {
      protoContent: '',
      protoFilename: '',
      serverAddress: '',
      service: '',
      method: '',
      requestMessage: '',
      metadata: [],
    },
    extracts: [],
    questions: [],
  };
}

function isBodyValid(body: string): boolean {
  if (body.trim() === '') {
    return true;
  }
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}

function isFormValid(form: FormState): boolean {
  if (form.taskName.trim() === '' || form.url.trim() === '') {
    return false;
  }
  if (!isBodyValid(form.body)) {
    return false;
  }
  for (const row of form.extracts) {
    if (row.source !== 'status' && row.path.trim() === '') return false;
    if (row.rememberAs.trim() === '') return false;
  }
  for (const row of form.questions) {
    if (row.source !== 'status' && row.path.trim() === '') return false;
    if (row.expected.trim() === '') return false;
  }
  return true;
}

export function App() {
  const [form, setForm] = useState<FormState>(initialForm());
  const [stepResults, setStepResults] = useState<(StepResult | undefined)[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actorOptions, setActorOptions] = useState<string[]>([]);
  const [taskOptions, setTaskOptions] = useState<string[]>([]);
  const [stepNames, setStepNames] = useState<string[]>([]);
  const [flowNames, setFlowNames] = useState<string[]>([]);

  useEffect(() => {
    fetchNames('/actors').then(setActorOptions);
    fetchNames('/tasks').then(setTaskOptions);
    fetchStepNames().then(setStepNames);
    fetchFlowNames().then(setFlowNames);
  }, []);

  function handleEvent(event: RunEvent) {
    if (event.type === 'step:completed' || event.type === 'step:failed') {
      setStepResults((prev) => {
        const next = [...prev];
        next[event.index] = event.result;
        return next;
      });
    }
  }

  function handleRunStart() {
    setError(null);
    setStepResults([]);

    const actorName = form.actorName.trim();
    if (actorName !== '' && !actorOptions.includes(actorName)) {
      saveName('/actors', actorName);
      setActorOptions((prev) => [...prev, actorName]);
    }

    const taskName = form.taskName.trim();
    if (taskName !== '' && !taskOptions.includes(taskName)) {
      saveName('/tasks', taskName);
      setTaskOptions((prev) => [...prev, taskName]);
    }
  }

  const variablesRecord = Object.fromEntries(
    form.variables.filter((row) => row.key.trim() !== '').map((row) => [row.key, row.value])
  );

  const results: DerivedResults | null =
    stepResults.length > 0 ? deriveResults(form.extracts, variablesRecord, stepResults) : null;

  return (
    <main className="app-main">
      <h1 className="heading-xl">API Runner — REST (Simple Mode)</h1>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <ScreenplayHeader
        actorName={form.actorName}
        onActorNameChange={(actorName) => setForm((prev) => ({ ...prev, actorName }))}
        taskName={form.taskName}
        onTaskNameChange={(taskName) => setForm((prev) => ({ ...prev, taskName }))}
        actorOptions={actorOptions}
        taskOptions={taskOptions}
      />
      <LoadStepSelect stepNames={stepNames} onLoad={setForm} />
      <KeyValueRows
        label="Variables"
        rows={form.variables}
        onChange={(variables) => setForm((prev) => ({ ...prev, variables }))}
      />
      <RequestBuilder
        method={form.method}
        onMethodChange={(method) => setForm((prev) => ({ ...prev, method }))}
        url={form.url}
        onUrlChange={(url) => setForm((prev) => ({ ...prev, url }))}
        params={form.params}
        onParamsChange={(params) => setForm((prev) => ({ ...prev, params }))}
        headers={form.headers}
        onHeadersChange={(headers) => setForm((prev) => ({ ...prev, headers }))}
        auth={form.auth}
        onAuthChange={(auth) => setForm((prev) => ({ ...prev, auth }))}
        body={form.body}
        onBodyChange={(body) => setForm((prev) => ({ ...prev, body }))}
        extracts={form.extracts}
        onExtractsChange={(extracts) => setForm((prev) => ({ ...prev, extracts }))}
        questions={form.questions}
        onQuestionsChange={(questions) => setForm((prev) => ({ ...prev, questions }))}
      />
      <RunButton
        form={form}
        disabled={!isFormValid(form)}
        onRunStart={handleRunStart}
        onEvent={handleEvent}
        onError={setError}
      />
      <SaveStepButton
        form={form}
        disabled={!isFormValid(form)}
        existingNames={stepNames}
        onSaved={setStepNames}
      />
      <AddToFlowButton stepNames={stepNames} flowNames={flowNames} onAdded={setFlowNames} />
      <ResultsPanel results={results} />
      <FlowRunner flowNames={flowNames} />
    </main>
  );
}
