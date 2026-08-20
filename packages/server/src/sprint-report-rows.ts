import type { JiraIssue } from './jira-client.js';

export const ROW_KEYS = ['PC', 'PCFUM', 'PCPOP_MP', 'PCPOP_UO', 'PCPOP_RC'] as const;
export type RowKey = (typeof ROW_KEYS)[number];

const PRODUCT_DOMAIN_TO_ROW: Record<string, RowKey> = {
  'Merchant Platform': 'PCPOP_MP',
  'Customer Experience': 'PCPOP_UO',
  'Reconciliation Core': 'PCPOP_RC',
};

export function jqlProjectScope(rowKey: RowKey): string {
  if (rowKey === 'PC' || rowKey === 'PCFUM') {
    return `project = ${rowKey}`;
  }
  const domain = Object.entries(PRODUCT_DOMAIN_TO_ROW).find(([, key]) => key === rowKey)?.[0];
  return `project = PCPOP AND "Product Domain" = "${domain}"`;
}

export function groupIssuesByRow(issues: JiraIssue[]): Record<RowKey, JiraIssue[]> {
  const groups: Record<RowKey, JiraIssue[]> = {
    PC: [],
    PCFUM: [],
    PCPOP_MP: [],
    PCPOP_UO: [],
    PCPOP_RC: [],
  };
  for (const issue of issues) {
    if (issue.project === 'PC') {
      groups.PC.push(issue);
    } else if (issue.project === 'PCFUM') {
      groups.PCFUM.push(issue);
    } else if (issue.project === 'PCPOP') {
      const rowKey = issue.productDomain ? PRODUCT_DOMAIN_TO_ROW[issue.productDomain] : undefined;
      if (rowKey) {
        groups[rowKey].push(issue);
      }
    }
  }
  return groups;
}
