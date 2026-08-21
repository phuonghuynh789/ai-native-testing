import type { SprintReportRowData } from './sprintReports';

type ExecutiveSummary = SprintReportRowData['executiveSummary'];
type DeliveryAssessment = Exclude<ExecutiveSummary['delivery'], 'unset'>;
type QualityAssessment = Exclude<ExecutiveSummary['quality'], 'unset'>;
type ImpactAnalysisAssessment = Exclude<ExecutiveSummary['impactAnalysis'], 'unset'>;
type OverallAssessment = Exclude<ExecutiveSummary['overall'], 'unset'>;

const DELIVERY_GOOD_THRESHOLD = 0.8;
const IA_BAD_MISSING_RATIO_THRESHOLD = 0.2;

export function assessDelivery(row: SprintReportRowData): DeliveryAssessment | null {
  const { predictability } = row.delivery;
  if (predictability === null) {
    return null;
  }
  return predictability >= DELIVERY_GOOD_THRESHOLD ? 'good' : 'bad';
}

export function assessQuality(row: SprintReportRowData): QualityAssessment {
  const { critical, major, prodBug } = row.quality;
  return critical === 0 && major === 0 && prodBug === 0 ? 'good' : 'bad';
}

export function assessImpactAnalysis(row: SprintReportRowData): ImpactAnalysisAssessment | null {
  const { totalTickets, iaMissingInfo } = row.impactAnalysis;
  if (totalTickets === 0) {
    return null;
  }
  if (iaMissingInfo === 0) {
    return 'good';
  }
  return iaMissingInfo / totalTickets > IA_BAD_MISSING_RATIO_THRESHOLD ? 'bad' : 'partial';
}

export function assessOverall(
  delivery: DeliveryAssessment | null,
  quality: QualityAssessment | null,
  impactAnalysis: ImpactAnalysisAssessment | null
): OverallAssessment | null {
  const values = [delivery, quality, impactAnalysis].filter(
    (value): value is NonNullable<typeof value> => value !== null
  );
  if (values.length === 0) {
    return null;
  }
  if (values.includes('bad')) {
    return 'bad';
  }
  if (values.every((value) => value === 'good')) {
    return 'good';
  }
  return 'medium';
}

export function suggestExecutiveSummary(row: SprintReportRowData): SprintReportRowData {
  const summary = row.executiveSummary;

  const delivery =
    summary.delivery === 'unset' ? (assessDelivery(row) ?? summary.delivery) : summary.delivery;
  const quality = summary.quality === 'unset' ? assessQuality(row) : summary.quality;
  const impactAnalysis =
    summary.impactAnalysis === 'unset' ? (assessImpactAnalysis(row) ?? summary.impactAnalysis) : summary.impactAnalysis;

  const overall =
    summary.overall === 'unset'
      ? (assessOverall(delivery === 'unset' ? null : delivery, quality, impactAnalysis === 'unset' ? null : impactAnalysis) ??
        summary.overall)
      : summary.overall;

  return { ...row, executiveSummary: { ...summary, delivery, quality, impactAnalysis, overall } };
}
