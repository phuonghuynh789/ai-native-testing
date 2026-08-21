import { describe, it, expect } from 'vitest';
import {
  buildDeliveryJiraLinks,
  buildQualityJiraLinks,
  buildSandboxDateJiraLinks,
  buildImpactAnalysisJiraLinks,
} from '../src/sprint-report-jira-links.js';
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
    expect(readyForTestJql).toContain('Sprint in ("PCDPC - Sprint 26.08.B","PCF-UM 26.08.B","OPF - 26.08.B")');
    expect(readyForTestJql).toContain('status in ("Ready for Testing", "In Test")');
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

    const noRCJql = decodeURIComponent(links.noRC.split('?jql=')[1]);
    expect(noRCJql).toContain('NOT (description ~ "RC" OR comment ~ "RC" OR description ~ "root cause" OR comment ~ "root cause")');
    expect(noRCJql).toContain('project = PC');
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

describe('buildImpactAnalysisJiraLinks', () => {
  const IA_KEYWORD_CLAUSE =
    '(description ~ "IA" OR comment ~ "IA" OR description ~ "Technical Impact" OR comment ~ "Technical Impact" OR description ~ "Impact Analysis" OR comment ~ "Impact Analysis")';

  it('builds an approximate Jira text-search URL for IA Good/Missing Info, scoped to the row project', () => {
    const links = buildImpactAnalysisJiraLinks(JIRA_CONFIG, 'PC', '26.08.B');

    for (const url of Object.values(links)) {
      expect(url.startsWith('https://jira.example.com/issues/?jql=')).toBe(true);
    }

    const iaGoodJql = decodeURIComponent(links.iaGood.split('?jql=')[1]);
    expect(iaGoodJql).toContain('Sprint in ("PCDPC - Sprint 26.08.B","PCF-UM 26.08.B","OPF - 26.08.B")');
    expect(iaGoodJql).toContain('status in ("Ready for Testing", "In Test")');
    expect(iaGoodJql).toContain('project = PC');
    expect(iaGoodJql).toContain(`AND ${IA_KEYWORD_CLAUSE}`);

    const iaMissingInfoJql = decodeURIComponent(links.iaMissingInfo.split('?jql=')[1]);
    expect(iaMissingInfoJql).toContain(`AND NOT ${IA_KEYWORD_CLAUSE}`);
  });

  it('scopes a PCPOP row by its Product Domain', () => {
    const links = buildImpactAnalysisJiraLinks(JIRA_CONFIG, 'PCPOP_MP', '26.08.B');
    const iaGoodJql = decodeURIComponent(links.iaGood.split('?jql=')[1]);
    expect(iaGoodJql).toContain('project = PCPOP AND "Product Domain" = "Merchant Platform"');
  });
});
