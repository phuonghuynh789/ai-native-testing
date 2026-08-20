export type { SprintReport, SprintReportRowData } from '@ai-native-testing/server/src/sprint-report-store.js';
export type { RowKey } from '@ai-native-testing/server/src/sprint-report-rows.js';
export { ROW_KEYS } from '@ai-native-testing/server/src/sprint-report-rows.js';

import type { SprintReport } from '@ai-native-testing/server/src/sprint-report-store.js';

export async function fetchSprintReport(sprintCode: string): Promise<SprintReport | undefined> {
  try {
    const response = await fetch(`/sprint-reports/${encodeURIComponent(sprintCode)}`);
    if (!response.ok) {
      return undefined;
    }
    return (await response.json()) as SprintReport;
  } catch {
    return undefined;
  }
}

export async function refreshSprintReport(
  sprintCode: string,
  params: { startDate: string; endDate: string; labels: string[] }
): Promise<SprintReport> {
  const response = await fetch(`/sprint-reports/${encodeURIComponent(sprintCode)}/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`Could not refresh the sprint report: ${(body as { error?: string }).error ?? response.status}`);
  }
  return (await response.json()) as SprintReport;
}

export async function saveSprintReport(report: SprintReport): Promise<SprintReport> {
  const response = await fetch(`/sprint-reports/${encodeURIComponent(report.sprintCode)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
  if (!response.ok) {
    throw new Error('Could not save the sprint report.');
  }
  return (await response.json()) as SprintReport;
}
