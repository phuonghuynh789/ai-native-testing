import { describe, it, expect } from 'vitest';
import {
  nextDay,
  buildCommittedJql,
  buildNewJql,
  buildDeliveredJql,
  buildReadyForTestJql,
  buildBugsJql,
} from '../src/sprint-report-jql.js';

describe('nextDay', () => {
  it('adds one day within the same month', () => {
    expect(nextDay('2026/08/19')).toBe('2026/08/20');
  });

  it('rolls over to the next month', () => {
    expect(nextDay('2026/08/31')).toBe('2026/09/01');
  });

  it('rolls over to the next year', () => {
    expect(nextDay('2026/12/31')).toBe('2027/01/01');
  });
});

describe('buildCommittedJql', () => {
  it('builds the exact committed JQL, matching by Sprint name per project', () => {
    const jql = buildCommittedJql({ sprintCode: '26.08.B' });
    expect(jql).toBe(
      'reporter != jira-webhook-bot AND type in (Task, Story) AND status != Cancelled ' +
        'AND Sprint in ("PCDPC - Sprint 26.08.B","PCF-UM 26.08.B","OPF - 26.08.B")'
    );
  });

  it('builds the three per-project sprint names generically for a different sprint code', () => {
    const jql = buildCommittedJql({ sprintCode: '26.09.A' });
    expect(jql).toContain('Sprint in ("PCDPC - Sprint 26.09.A","PCF-UM 26.09.A","OPF - 26.09.A")');
  });
});

describe('buildNewJql', () => {
  it('builds the exact new-tickets JQL: Committed scope minus tickets that have progressed past New', () => {
    const jql = buildNewJql({ sprintCode: '26.08.B' });
    expect(jql).toBe(
      'reporter != jira-webhook-bot AND type in (Task, Story) AND status != Cancelled ' +
        'and status not in ("ready for testing", "In test", Done) ' +
        'AND Sprint in ("PCDPC - Sprint 26.08.B","PCF-UM 26.08.B","OPF - 26.08.B")'
    );
  });
});

describe('buildDeliveredJql', () => {
  it('builds the exact delivered JQL, computing endPlusOne', () => {
    const jql = buildDeliveredJql({ start: '2026/08/06', end: '2026/08/19', labels: ['nhuvth'] });
    expect(jql).toBe(
      'status changed to Done during ("2026/08/06", "2026/08/19") ' +
        'AND NOT status changed to Done during ("2026/08/20", "2027/12/31") ' +
        'AND statusCategory = Done AND status in (Done, Live) ' +
        'AND project in (PC, PCFUM, PCPOP) AND type in (Task, Story) AND labels in (nhuvth)'
    );
  });

  it('omits the labels clause entirely when no labels are given', () => {
    const jql = buildDeliveredJql({ start: '2026/08/06', end: '2026/08/19', labels: [] });
    expect(jql).toBe(
      'status changed to Done during ("2026/08/06", "2026/08/19") ' +
        'AND NOT status changed to Done during ("2026/08/20", "2027/12/31") ' +
        'AND statusCategory = Done AND status in (Done, Live) ' +
        'AND project in (PC, PCFUM, PCPOP) AND type in (Task, Story)'
    );
    expect(jql).not.toContain('labels');
  });
});

describe('buildReadyForTestJql', () => {
  it('builds the exact ready-for-test JQL', () => {
    const jql = buildReadyForTestJql({ start: '2026/08/06', end: '2026/08/19', labels: ['nhuvth'] });
    expect(jql).toBe(
      'status changed to "Ready for Testing" during ("2026/08/06", "2026/08/19") ' +
        'AND NOT status changed to "Ready for Testing" during ("2026/08/20", "2027/12/31") ' +
        'AND project in (PC, PCFUM, PCPOP) AND type in (Task, Story) AND labels in (nhuvth)'
    );
  });

  it('omits the labels clause entirely when no labels are given', () => {
    const jql = buildReadyForTestJql({ start: '2026/08/06', end: '2026/08/19', labels: [] });
    expect(jql).toBe(
      'status changed to "Ready for Testing" during ("2026/08/06", "2026/08/19") ' +
        'AND NOT status changed to "Ready for Testing" during ("2026/08/20", "2027/12/31") ' +
        'AND project in (PC, PCFUM, PCPOP) AND type in (Task, Story)'
    );
    expect(jql).not.toContain('labels');
  });
});

describe('buildBugsJql', () => {
  it('builds the exact bugs JQL, with no labels filter', () => {
    const jql = buildBugsJql({ start: '2026/08/06', end: '2026/08/19' });
    expect(jql).toBe(
      'type = Bug AND created >= "2026/08/06" AND created <= "2026/08/19" ' +
        'AND NOT (reporter = automationtest_bot AND project = PQED) AND project IN (PC, PCPOP, PCFUM)'
    );
  });
});
