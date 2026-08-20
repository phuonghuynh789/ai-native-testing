import type { JiraIssue } from './jira-client.js';

export interface QualityRow {
  totalBugs: number;
  critical: number;
  major: number;
  minor: number;
  prodBug: number;
  noRC: number;
}

export function mapPriorityToSeverity(priority: string | null): 'critical' | 'major' | 'minor' | null {
  if (priority === 'P1 (Highest)' || priority === 'P2 (High)') {
    return 'critical';
  }
  if (priority === 'P3 (Medium)') {
    return 'major';
  }
  if (priority === 'P4 (Low)' || priority === 'P5 (Lowest)') {
    return 'minor';
  }
  return null;
}

export function isProdBug(bugEnvironments: string[]): boolean {
  return bugEnvironments.includes('Production');
}

export function hasRootCauseKeyword(text: string): boolean {
  if (/\brc\b/i.test(text)) {
    return true;
  }
  return text.toLowerCase().includes('root cause');
}

export function computeQualityRow(bugs: JiraIssue[], hasRootCauseResults: boolean[]): QualityRow {
  let critical = 0;
  let major = 0;
  let minor = 0;
  let prodBug = 0;
  for (const bug of bugs) {
    const severity = mapPriorityToSeverity(bug.priority);
    if (severity === 'critical') {
      critical += 1;
    } else if (severity === 'major') {
      major += 1;
    } else if (severity === 'minor') {
      minor += 1;
    }
    if (isProdBug(bug.bugEnvironments)) {
      prodBug += 1;
    }
  }
  const noRC = hasRootCauseResults.filter((hasKeyword) => !hasKeyword).length;
  return { totalBugs: bugs.length, critical, major, minor, prodBug, noRC };
}
