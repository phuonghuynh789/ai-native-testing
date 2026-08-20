export interface JqlDateParams {
  start: string;
  end: string;
  labels: string[];
}

export function nextDay(dateYYYYMMDD: string): string {
  const [year, month, day] = dateYYYYMMDD.split('/').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 1);
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  const nextDayOfMonth = String(date.getUTCDate()).padStart(2, '0');
  return `${nextYear}/${nextMonth}/${nextDayOfMonth}`;
}

export function buildCommittedJql(params: JqlDateParams): string {
  return (
    `project in (PC, PCFUM, PCPOP) AND created >= "${params.start}" AND created <= "${params.end}" ` +
    `AND type in (Task, Story) AND type != Bug AND reporter != jira-webhook-bot ` +
    `AND status != Cancelled AND labels in (${params.labels.join(', ')})`
  );
}

export function buildDeliveredJql(params: JqlDateParams): string {
  const endPlusOne = nextDay(params.end);
  return (
    `status changed to Done during ("${params.start}", "${params.end}") ` +
    `AND NOT status changed to Done during ("${endPlusOne}", "2027/12/31") ` +
    `AND statusCategory = Done AND status in (Done, Live) ` +
    `AND project in (PC, PCFUM, PCPOP) AND type in (Task, Story) AND labels in (${params.labels.join(', ')})`
  );
}

export function buildReadyForTestJql(params: JqlDateParams): string {
  const endPlusOne = nextDay(params.end);
  return (
    `status changed to "Ready for Testing" during ("${params.start}", "${params.end}") ` +
    `AND NOT status changed to "Ready for Testing" during ("${endPlusOne}", "2027/12/31") ` +
    `AND project in (PC, PCFUM, PCPOP) AND type in (Task, Story) AND labels in (${params.labels.join(', ')})`
  );
}

export function buildBugsJql(params: Pick<JqlDateParams, 'start' | 'end'>): string {
  return (
    `type = Bug AND created >= "${params.start}" AND created <= "${params.end}" ` +
    `AND NOT (reporter = automationtest_bot AND project = PQED) AND project IN (PC, PCPOP, PCFUM)`
  );
}
