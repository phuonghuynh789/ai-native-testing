export type NameListEndpoint = '/actors' | '/tasks';

export async function fetchNames(endpoint: NameListEndpoint): Promise<string[]> {
  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      return [];
    }
    return (await response.json()) as string[];
  } catch {
    return [];
  }
}

export function saveName(endpoint: NameListEndpoint, name: string): void {
  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).catch(() => {});
}
