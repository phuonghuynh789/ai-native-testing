import type { FormState } from './types';

function normalizeFormState(form: FormState): FormState {
  return {
    ...form,
    kafkaCheck: form.kafkaCheck ?? { enabled: false, topic: 'transLogV1' },
    afterResponse: form.afterResponse ?? [],
  };
}

export async function fetchStepNames(): Promise<string[]> {
  try {
    const response = await fetch('/steps');
    if (!response.ok) {
      return [];
    }
    return (await response.json()) as string[];
  } catch {
    return [];
  }
}

export async function fetchStep(name: string): Promise<FormState | undefined> {
  try {
    const response = await fetch(`/steps/${encodeURIComponent(name)}`);
    if (!response.ok) {
      return undefined;
    }
    return normalizeFormState((await response.json()) as FormState);
  } catch {
    return undefined;
  }
}

export async function saveStep(name: string, form: FormState): Promise<string[] | undefined> {
  try {
    const response = await fetch('/steps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content: form }),
    });
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as { names: string[] };
    return body.names;
  } catch {
    return undefined;
  }
}
