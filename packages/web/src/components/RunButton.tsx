import type { RunEvent } from '@ai-native-testing/engine';
import { buildTestDefinition } from '../dsl';
import { correlatorFieldFor, extractCorrelatorValue, registerKafkaCheck } from '../kafkaChecks';
import type { FormState } from '../types';

interface RunButtonProps {
  form: FormState;
  disabled: boolean;
  onRunStart: () => void;
  onEvent: (event: RunEvent) => void;
  onError: (message: string) => void;
}

export function RunButton({ form, disabled, onRunStart, onEvent, onError }: RunButtonProps) {
  async function handleClick() {
    onRunStart();

    if (form.kafkaCheck.enabled) {
      const correlatorValue = extractCorrelatorValue(form, form.kafkaCheck.topic);
      if (correlatorValue === undefined) {
        onError(
          `Check Kafka: could not find "${correlatorFieldFor(form.kafkaCheck.topic)}" in the request body.`
        );
      } else {
        registerKafkaCheck({
          message_id: correlatorValue,
          name: form.taskName,
          topic: form.kafkaCheck.topic,
        }).catch(() => {
          onError('Check Kafka: could not register the tracking check.');
        });
      }
    }

    let definition;
    try {
      definition = buildTestDefinition(form);
    } catch (err) {
      onError(`Invalid request: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    let jobId: string;
    try {
      const response = await fetch('/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(definition),
      });
      if (!response.ok) {
        const body = await response.json();
        onError(`Could not start run: ${JSON.stringify(body)}`);
        return;
      }
      const body = (await response.json()) as { jobId: string };
      jobId = body.jobId;
    } catch (err) {
      onError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const source = new EventSource(`/runs/${jobId}/events`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as RunEvent;
      onEvent(event);
      if (event.type === 'run:completed' || event.type === 'run:failed') {
        source.close();
      }
    };
    source.onerror = () => {
      onError('Connection lost — partial results shown below.');
      source.close();
    };
  }

  return (
    <button type="button" className="btn-primary" onClick={handleClick} disabled={disabled}>
      Run
    </button>
  );
}
