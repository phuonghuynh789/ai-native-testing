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
