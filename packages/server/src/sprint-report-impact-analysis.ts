import type { JiraIssue } from './jira-client.js';

const MULTI_WORD_KEYWORDS = ['technical impact', 'impact analysis'];

export function hasImpactAnalysisKeyword(text: string): boolean {
  if (/\bia\b/i.test(text)) {
    return true;
  }
  const lower = text.toLowerCase();
  return MULTI_WORD_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export interface ImpactAnalysisRow {
  totalTickets: number;
  iaGood: number;
  iaMissingInfo: number;
}

export function computeImpactAnalysisRow(hasKeywordResults: boolean[]): ImpactAnalysisRow {
  const iaGood = hasKeywordResults.filter(Boolean).length;
  return {
    totalTickets: hasKeywordResults.length,
    iaGood,
    iaMissingInfo: hasKeywordResults.length - iaGood,
  };
}

export interface MissingImpactRow {
  ticket: string;
  missingInfo: string;
}

export function prefillMissingImpactTable(
  readyForTest: JiraIssue[],
  hasKeywordResults: boolean[]
): MissingImpactRow[] {
  const rows: MissingImpactRow[] = [];
  readyForTest.forEach((issue, index) => {
    if (!hasKeywordResults[index]) {
      rows.push({ ticket: issue.key, missingInfo: '' });
    }
  });
  return rows;
}
