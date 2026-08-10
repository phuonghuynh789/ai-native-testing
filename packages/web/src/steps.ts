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

export interface StepSummary {
  name: string;
  protocol: string;
  method: string;
  url: string;
  grpcService: string;
  grpcMethod: string;
}

export interface StepSearchResult {
  items: StepSummary[];
  total: number;
}

export async function searchSteps(query: string, page: number, pageSize: number): Promise<StepSearchResult> {
  try {
    const params = new URLSearchParams({ search: query, page: String(page), pageSize: String(pageSize) });
    const response = await fetch(`/steps/search?${params.toString()}`);
    if (!response.ok) {
      return { items: [], total: 0 };
    }
    return (await response.json()) as StepSearchResult;
  } catch {
    return { items: [], total: 0 };
  }
}

export async function deleteStep(name: string): Promise<string[] | undefined> {
  try {
    const response = await fetch(`/steps/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as { names: string[] };
    return body.names;
  } catch {
    return undefined;
  }
}
