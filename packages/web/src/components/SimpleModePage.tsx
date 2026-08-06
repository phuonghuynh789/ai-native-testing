import type { Dispatch, SetStateAction } from 'react';
import type { RunEvent } from '@ai-native-testing/engine';
import type { FormState } from '../types';
import type { DerivedResults } from '../results';
import { ScreenplayHeader } from './ScreenplayHeader';
import { KeyValueRows } from './KeyValueRows';
import { RequestBuilder } from './RequestBuilder';
import { RunButton } from './RunButton';
import { ResultsPanel } from './ResultsPanel';
import { SaveStepButton } from './SaveStepButton';
import { LoadStepSelect } from './LoadStepSelect';
import { AddToFlowButton } from './AddToFlowButton';

export interface SimpleModePageProps {
  error: string | null;
  form: FormState;
  onFormChange: Dispatch<SetStateAction<FormState>>;
  actorOptions: string[];
  taskOptions: string[];
  stepNames: string[];
  onStepNamesChange: (names: string[]) => void;
  flowNames: string[];
  onFlowNamesChange: (flowNames: string[]) => void;
  results: DerivedResults | null;
  disabled: boolean;
  onRunStart: () => void;
  onEvent: (event: RunEvent) => void;
  onError: (message: string) => void;
}

export function SimpleModePage({
  error,
  form,
  onFormChange,
  actorOptions,
  taskOptions,
  stepNames,
  onStepNamesChange,
  flowNames,
  onFlowNamesChange,
  results,
  disabled,
  onRunStart,
  onEvent,
  onError,
}: SimpleModePageProps) {
  return (
    <main className="app-main">
      <h1 className="heading-xl">Simple Mode</h1>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <ScreenplayHeader
        actorName={form.actorName}
        onActorNameChange={(actorName) => onFormChange((prev) => ({ ...prev, actorName }))}
        taskName={form.taskName}
        onTaskNameChange={(taskName) => onFormChange((prev) => ({ ...prev, taskName }))}
        actorOptions={actorOptions}
        taskOptions={taskOptions}
      />
      <LoadStepSelect stepNames={stepNames} onLoad={onFormChange} />
      <KeyValueRows
        label="Variables"
        rows={form.variables}
        onChange={(variables) => onFormChange((prev) => ({ ...prev, variables }))}
      />
      <RequestBuilder
        protocol={form.protocol}
        onProtocolChange={(protocol) => onFormChange((prev) => ({ ...prev, protocol }))}
        method={form.method}
        onMethodChange={(method) => onFormChange((prev) => ({ ...prev, method }))}
        url={form.url}
        onUrlChange={(url) => onFormChange((prev) => ({ ...prev, url }))}
        params={form.params}
        onParamsChange={(params) => onFormChange((prev) => ({ ...prev, params }))}
        headers={form.headers}
        onHeadersChange={(headers) => onFormChange((prev) => ({ ...prev, headers }))}
        auth={form.auth}
        onAuthChange={(auth) => onFormChange((prev) => ({ ...prev, auth }))}
        body={form.body}
        onBodyChange={(body) => onFormChange((prev) => ({ ...prev, body }))}
        grpc={form.grpc}
        onGrpcChange={(grpc) => onFormChange((prev) => ({ ...prev, grpc }))}
        extracts={form.extracts}
        onExtractsChange={(extracts) => onFormChange((prev) => ({ ...prev, extracts }))}
        questions={form.questions}
        onQuestionsChange={(questions) => onFormChange((prev) => ({ ...prev, questions }))}
        variables={form.variables}
        onVariablesChange={(variables) => onFormChange((prev) => ({ ...prev, variables }))}
        afterResponse={form.afterResponse}
        onAfterResponseChange={(afterResponse) => onFormChange((prev) => ({ ...prev, afterResponse }))}
        kafkaCheck={form.kafkaCheck}
        onKafkaCheckChange={(kafkaCheck) => onFormChange((prev) => ({ ...prev, kafkaCheck }))}
      />
      <RunButton form={form} disabled={disabled} onRunStart={onRunStart} onEvent={onEvent} onError={onError} />
      <SaveStepButton form={form} disabled={disabled} existingNames={stepNames} onSaved={onStepNamesChange} />
      <AddToFlowButton stepNames={stepNames} flowNames={flowNames} onAdded={onFlowNamesChange} />
      <ResultsPanel results={results} />
    </main>
  );
}
