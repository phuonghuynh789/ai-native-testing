export async function fetchFlowNames(): Promise<string[]> {
  try {
    const response = await fetch('/flows');
    if (!response.ok) {
      return [];
    }
    return (await response.json()) as string[];
  } catch {
    return [];
  }
}

export async function fetchFlow(name: string): Promise<string[] | undefined> {
  try {
    const response = await fetch(`/flows/${encodeURIComponent(name)}`);
    if (!response.ok) {
      return undefined;
    }
    return (await response.json()) as string[];
  } catch {
    return undefined;
  }
}

export async function addStepToFlow(flowName: string, stepName: string): Promise<string[] | undefined> {
  try {
    const response = await fetch('/flows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flowName, stepName }),
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

export async function setFlow(name: string, stepNames: string[]): Promise<string[] | undefined> {
  try {
    const response = await fetch(`/flows/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepNames }),
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
