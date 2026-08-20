import { describe, it, expect } from 'vitest';
import { buildDeliveryJiraLinks, buildQualityJiraLinks, buildSandboxDateJiraLinks } from '../src/sprint-report-jira-links.js';
import type { JiraConfig } from '../src/jira-config.js';

const JIRA_CONFIG: JiraConfig = { baseUrl: 'https://jira.example.com', token: 'test-token' };

describe('buildDeliveryJiraLinks', () => {
  it('builds a Jira issue-search URL per query, scoped to the row project', () => {
    const links = buildDeliveryJiraLinks(JIRA_CONFIG, 'PC', '26.08.B', {
      start: '2026/08/06',
      end: '2026/08/19',
      labels: [],
    });

    for (const url of Object.values(links)) {
      expect(url.startsWith('https://jira.example.com/issues/?jql=')).toBe(true);
    }

    const committedJql = decodeURIComponent(links.committed.split('?jql=')[1]);
    expect(committedJql).toContain('Sprint in ("PCDPC - Sprint 26.08.B","PCF-UM 26.08.B","OPF - 26.08.B")');
    expect(committedJql).toContain('project = PC');

    const deliveredJql = decodeURIComponent(links.delivered.split('?jql=')[1]);
    expect(deliveredJql).toContain('status changed to Done during');
    expect(deliveredJql).toContain('project = PC');

    const readyForTestJql = decodeURIComponent(links.readyForTest.split('?jql=')[1]);
    expect(readyForTestJql).toContain('status changed to "Ready for Testing" during');
    expect(readyForTestJql).toContain('project = PC');

    const newJql = decodeURIComponent(links.new.split('?jql=')[1]);
    expect(newJql).toContain('status not in ("ready for testing", "In test", Done)');
    expect(newJql).toContain('project = PC');
  });

  it('scopes a PCPOP row by its Product Domain', () => {
    const links = buildDeliveryJiraLinks(JIRA_CONFIG, 'PCPOP_MP', '26.08.B', {
      start: '2026/08/06',
      end: '2026/08/19',
      labels: [],
    });
    const committedJql = decodeURIComponent(links.committed.split('?jql=')[1]);
    expect(committedJql).toContain('project = PCPOP AND "Product Domain" = "Merchant Platform"');
  });
});

describe('buildQualityJiraLinks', () => {
  it('builds a Jira issue-search URL per severity bucket plus Prod Bug, scoped to the row project', () => {
    const links = buildQualityJiraLinks(JIRA_CONFIG, 'PC', { start: '2026/08/06', end: '2026/08/19' });

    for (const url of Object.values(links)) {
      expect(url.startsWith('https://jira.example.com/issues/?jql=')).toBe(true);
    }

    const totalBugsJql = decodeURIComponent(links.totalBugs.split('?jql=')[1]);
    expect(totalBugsJql).toContain('type = Bug');
    expect(totalBugsJql).toContain('project = PC');
    expect(totalBugsJql).not.toContain('priority');

    const criticalJql = decodeURIComponent(links.critical.split('?jql=')[1]);
    expect(criticalJql).toContain('priority in ("P1 (Highest)", "P2 (High)")');

    const majorJql = decodeURIComponent(links.major.split('?jql=')[1]);
    expect(majorJql).toContain('priority = "P3 (Medium)"');

    const minorJql = decodeURIComponent(links.minor.split('?jql=')[1]);
    expect(minorJql).toContain('priority in ("P4 (Low)", "P5 (Lowest)")');

    const prodBugJql = decodeURIComponent(links.prodBug.split('?jql=')[1]);
    expect(prodBugJql).toContain('"Bug in Environments:" = Production');
  });
});

describe('buildSandboxDateJiraLinks', () => {
  it('builds a Jira issue-search URL per Sandbox Date bucket, scoped to the row project', () => {
    const links = buildSandboxDateJiraLinks(JIRA_CONFIG, 'PC', '26.08.B', '2026/08/19');

    for (const url of Object.values(links)) {
      expect(url.startsWith('https://jira.example.com/issues/?jql=')).toBe(true);
    }

    const readyOrInTestJql = decodeURIComponent(links.readyOrInTest.split('?jql=')[1]);
    expect(readyOrInTestJql).toContain('Sprint in ("PCDPC - Sprint 26.08.B","PCF-UM 26.08.B","OPF - 26.08.B")');
    expect(readyOrInTestJql).toContain('status in ("Ready for Testing", "In Test")');
    expect(readyOrInTestJql).toContain('project = PC');
    expect(readyOrInTestJql).not.toContain('Sandbox Date');

    const missingJql = decodeURIComponent(links.missingSandboxDate.split('?jql=')[1]);
    expect(missingJql).toContain('"Sandbox Date" is EMPTY');

    const equalsJql = decodeURIComponent(links.equalsSprintEnd.split('?jql=')[1]);
    expect(equalsJql).toContain('"Sandbox Date" = "2026/08/19"');

    const minus1Jql = decodeURIComponent(links.minus1.split('?jql=')[1]);
    expect(minus1Jql).toContain('"Sandbox Date" = "2026/08/18"');

    const plus1Jql = decodeURIComponent(links.plus1.split('?jql=')[1]);
    expect(plus1Jql).toContain('"Sandbox Date" = "2026/08/20"');

    const plus2Jql = decodeURIComponent(links.plus2.split('?jql=')[1]);
    expect(plus2Jql).toContain('"Sandbox Date" = "2026/08/21"');
  });

  it('scopes a PCPOP row by its Product Domain', () => {
    const links = buildSandboxDateJiraLinks(JIRA_CONFIG, 'PCPOP_RC', '26.08.B', '2026/08/19');
    const readyOrInTestJql = decodeURIComponent(links.readyOrInTest.split('?jql=')[1]);
    expect(readyOrInTestJql).toContain('project = PCPOP AND "Product Domain" = "Reconciliation Core"');
  });
});
