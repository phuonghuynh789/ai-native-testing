import type { JiraIssue } from './jira-client.js';

export interface QualityRow {
  totalBugs: number;
  critical: number;
  major: number;
  minor: number;
  prodBug: number;
}

export function mapPriorityToSeverity(priority: string | null): 'critical' | 'major' | 'minor' | null {
  if (priority === 'Highest') {
    return 'critical';
  }
  if (priority === 'High' || priority === 'Medium') {
    return 'major';
  }
  if (priority === 'Low' || priority === 'Lowest') {
    return 'minor';
  }
  return null;
}

export function isProdBug(bugEnvironments: string[]): boolean {
  return bugEnvironments.includes('Production');
}

export function computeQualityRow(bugs: JiraIssue[]): QualityRow {
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
  return { totalBugs: bugs.length, critical, major, minor, prodBug };
}
