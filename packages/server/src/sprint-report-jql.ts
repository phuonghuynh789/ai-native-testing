export interface JqlDateParams {
  start: string;
  end: string;
  labels: string[];
}

export interface CommittedJqlParams {
  sprintCode: string;
}

export function addDays(dateYYYYMMDD: string, days: number): string {
  const [year, month, day] = dateYYYYMMDD.split('/').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  const resultYear = date.getUTCFullYear();
  const resultMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  const resultDay = String(date.getUTCDate()).padStart(2, '0');
  return `${resultYear}/${resultMonth}/${resultDay}`;
}

export function nextDay(dateYYYYMMDD: string): string {
  return addDays(dateYYYYMMDD, 1);
}

function labelsClause(labels: string[]): string {
  return labels.length > 0 ? ` AND labels in (${labels.join(', ')})` : '';
}

function committedSprintNames(sprintCode: string): string[] {
  return [`PCDPC - Sprint ${sprintCode}`, `PCF-UM ${sprintCode}`, `OPF - ${sprintCode}`];
}

export function buildCommittedJql(params: CommittedJqlParams): string {
  const sprintNamesClause = committedSprintNames(params.sprintCode)
    .map((name) => `"${name}"`)
    .join(',');
  return (
    `reporter != jira-webhook-bot AND type in (Task, Story) AND status != Cancelled ` +
    `AND Sprint in (${sprintNamesClause})`
  );
}

export function buildNewJql(params: CommittedJqlParams): string {
  const sprintNamesClause = committedSprintNames(params.sprintCode)
    .map((name) => `"${name}"`)
    .join(',');
  return (
    `reporter != jira-webhook-bot AND type in (Task, Story) AND status != Cancelled ` +
    `and status not in ("ready for testing", "In test", Done) ` +
    `AND Sprint in (${sprintNamesClause})`
  );
}

export function buildDeliveredJql(params: JqlDateParams): string {
  const endPlusOne = nextDay(params.end);
  return (
    `status changed to Done during ("${params.start}", "${params.end}") ` +
    `AND NOT status changed to Done during ("${endPlusOne}", "2027/12/31") ` +
    `AND statusCategory = Done AND status in (Done, Live) ` +
    `AND project in (PC, PCFUM, PCPOP) AND type in (Task, Story)${labelsClause(params.labels)}`
  );
}

export function buildReadyForTestJql(params: JqlDateParams): string {
  const endPlusOne = nextDay(params.end);
  return (
    `status changed to "Ready for Testing" during ("${params.start}", "${params.end}") ` +
    `AND NOT status changed to "Ready for Testing" during ("${endPlusOne}", "2027/12/31") ` +
    `AND status not in (Done, Live) ` +
    `AND project in (PC, PCFUM, PCPOP) AND type in (Task, Story)${labelsClause(params.labels)}`
  );
}

export function buildBugsJql(params: Pick<JqlDateParams, 'start' | 'end'>): string {
  return (
    `type = Bug AND created >= "${params.start}" AND created <= "${params.end}" ` +
    `AND NOT (reporter = automationtest_bot AND project = PQED) AND project IN (PC, PCPOP, PCFUM)`
  );
}
