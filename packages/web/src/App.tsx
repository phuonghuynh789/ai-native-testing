import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import type { RunEvent, StepResult } from '@ai-native-testing/engine';
import type { FormState } from './types';
import { deriveResults, type DerivedResults } from './results';
import { fetchNames, saveName } from './nameLists';
import { fetchStepNames } from './steps';
import { fetchFlowNames } from './flows';
import { Sidebar } from './components/Sidebar';
import { SimpleModePage } from './components/SimpleModePage';
import { EndToEndTestPage } from './components/EndToEndTestPage';
import { ApiAutomationPage } from './components/ApiAutomationPage';
import { KafkaChecksPage } from './components/KafkaChecksPage';

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
      secure: true,
      skipCertVerification: false,
    },
    extracts: [],
    questions: [],
    kafkaCheck: { enabled: false, topic: 'transLogV1' },
    afterResponse: [],
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

function isGrpcMessageValid(requestMessage: string): boolean {
  if (requestMessage.trim() === '') {
    return true;
  }
  try {
    JSON.parse(requestMessage);
    return true;
  } catch {
    return false;
  }
}

function isFormValid(form: FormState): boolean {
  if (form.taskName.trim() === '') {
    return false;
  }
  if (form.protocol === 'grpc') {
    if (
      form.grpc.serverAddress.trim() === '' ||
      form.grpc.service.trim() === '' ||
      form.grpc.method.trim() === '' ||
      form.grpc.protoContent.trim() === ''
    ) {
      return false;
    }
    if (!isGrpcMessageValid(form.grpc.requestMessage)) {
      return false;
    }
  } else {
    if (form.url.trim() === '') {
      return false;
    }
    if (!isBodyValid(form.body)) {
      return false;
    }
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
    stepResults.length > 0 ? deriveResults(form.extracts, form.afterResponse, variablesRecord, stepResults) : null;

  const disabled = !isFormValid(form);

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="app-shell">
        <Sidebar />
        <Routes>
          <Route
            path="/"
            element={
              <SimpleModePage
                error={error}
                form={form}
                onFormChange={setForm}
                actorOptions={actorOptions}
                taskOptions={taskOptions}
                stepNames={stepNames}
                onStepNamesChange={setStepNames}
                flowNames={flowNames}
                onFlowNamesChange={setFlowNames}
                results={results}
                disabled={disabled}
                onRunStart={handleRunStart}
                onEvent={handleEvent}
                onError={setError}
              />
            }
          />
          <Route
            path="/e2e-test"
            element={
              <EndToEndTestPage
                flowNames={flowNames}
                onFlowNamesChange={setFlowNames}
                stepNames={stepNames}
              />
            }
          />
          <Route
            path="/api-automation"
            element={
              <ApiAutomationPage
                stepNames={stepNames}
                flowNames={flowNames}
                onFormChange={setForm}
              />
            }
          />
          <Route path="/kafka-checks" element={<KafkaChecksPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
