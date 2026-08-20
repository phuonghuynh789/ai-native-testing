import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RowKey } from './sprint-report-rows.js';
import type { DeliveryRow, SandboxDateBreakdown } from './sprint-report-delivery.js';
import type { QualityRow } from './sprint-report-quality.js';
import type { ImpactAnalysisRow, MissingImpactRow } from './sprint-report-impact-analysis.js';

export type TriState = 'unset' | 'pass' | 'fail';

export interface QualityChecklist {
  noCriticalBug: TriState;
  noProductionBug: TriState;
  reopenRateUnder10: TriState;
  uatStable: TriState;
  assessment: 'unset' | 'good' | 'need-improvement';
}

export interface ExecutiveSummaryRow {
  delivery: 'unset' | 'good' | 'bad';
  quality: 'unset' | 'good' | 'bad';
  impactAnalysis: 'unset' | 'good' | 'partial' | 'bad';
  overall: 'unset' | 'good' | 'medium' | 'bad';
  commentary: string;
}

export interface SprintReportRowData {
  rowKey: RowKey;
  delivery: DeliveryRow;
  quality: QualityRow;
  impactAnalysis: ImpactAnalysisRow;
  qualityChecklist: QualityChecklist;
  iaWrongScope: number;
  sandboxDateBreakdown: SandboxDateBreakdown;
  missingImpact: MissingImpactRow[];
  executiveSummary: ExecutiveSummaryRow;
}

export interface SprintReport {
  sprintCode: string;
  startDate: string;
  endDate: string;
  labels: string[];
  rows: SprintReportRowData[];
  deliveryComment: string;
  createdAt: string;
  updatedAt: string;
}

export class SprintReportStore {
  constructor(private readonly filePath: string) {}

  async get(sprintCode: string): Promise<SprintReport | undefined> {
    const map = await this.readMap();
    return map[sprintCode];
  }

  async save(report: SprintReport): Promise<SprintReport> {
    const map = await this.readMap();
    const now = new Date().toISOString();
    const existing = map[report.sprintCode];
    const saved: SprintReport = {
      ...report,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    map[report.sprintCode] = saved;
    await this.write(map);
    return saved;
  }

  private async readMap(): Promise<Record<string, SprintReport>> {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      return JSON.parse(contents) as Record<string, SprintReport>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.write({});
        return {};
      }
      throw err;
    }
  }

  private async write(map: Record<string, SprintReport>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(map, null, 2));
  }
}
