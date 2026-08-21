import { describe, it, expect } from 'vitest';
import { groupIssuesByRow, jqlProjectScope } from '../src/sprint-report-rows.js';
import type { JiraIssue } from '../src/jira-client.js';

function issue(overrides: Partial<JiraIssue>): JiraIssue {
  return {
    key: 'X-1',
    project: 'PC',
    summary: '',
    status: 'Open',
    priority: null,
    labels: [],
    created: null,
    storyPoints: null,
    productDomain: null,
    bugEnvironments: [],
    sandboxDate: null,
    ...overrides,
  };
}

describe('groupIssuesByRow', () => {
  it('groups PC and PCFUM issues directly by project', () => {
    const groups = groupIssuesByRow([issue({ key: 'PC-1', project: 'PC' }), issue({ key: 'FUM-1', project: 'PCFUM' })]);
    expect(groups.PC.map((i) => i.key)).toEqual(['PC-1']);
    expect(groups.PCFUM.map((i) => i.key)).toEqual(['FUM-1']);
  });

  it('splits PCPOP issues by Product Domain into three rows', () => {
    const groups = groupIssuesByRow([
      issue({ key: 'OP-1', project: 'PCPOP', productDomain: 'Merchant Platform' }),
      issue({ key: 'OP-2', project: 'PCPOP', productDomain: 'Customer Experience' }),
      issue({ key: 'OP-3', project: 'PCPOP', productDomain: 'Reconciliation Core' }),
    ]);
    expect(groups.PCPOP_MP.map((i) => i.key)).toEqual(['OP-1']);
    expect(groups.PCPOP_UO.map((i) => i.key)).toEqual(['OP-2']);
    expect(groups.PCPOP_RC.map((i) => i.key)).toEqual(['OP-3']);
  });

  it('drops a PCPOP issue with no recognized Product Domain', () => {
    const groups = groupIssuesByRow([issue({ key: 'OP-9', project: 'PCPOP', productDomain: null })]);
    expect(groups.PCPOP_MP).toEqual([]);
    expect(groups.PCPOP_UO).toEqual([]);
    expect(groups.PCPOP_RC).toEqual([]);
  });

  it('ignores an issue from an unrecognized project', () => {
    const groups = groupIssuesByRow([issue({ key: 'OTHER-1', project: 'OTHER' })]);
    expect(Object.values(groups).flat()).toEqual([]);
  });
});

describe('jqlProjectScope', () => {
  it('scopes PC and PCFUM to their own project', () => {
    expect(jqlProjectScope('PC')).toBe('project = PC');
    expect(jqlProjectScope('PCFUM')).toBe('project = PCFUM');
  });

  it('scopes each PCPOP row to project PCPOP plus its Product Domain value', () => {
    expect(jqlProjectScope('PCPOP_MP')).toBe('project = PCPOP AND "Product Domain" = "Merchant Platform"');
    expect(jqlProjectScope('PCPOP_UO')).toBe('project = PCPOP AND "Product Domain" = "Customer Experience"');
    expect(jqlProjectScope('PCPOP_RC')).toBe('project = PCPOP AND "Product Domain" = "Reconciliation Core"');
  });
});
