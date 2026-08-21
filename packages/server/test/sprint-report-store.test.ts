import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SprintReportStore, type SprintReport, type SprintReportRowData } from '../src/sprint-report-store.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sprint-report-store-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function sampleRow(rowKey: SprintReportRowData['rowKey']): SprintReportRowData {
  return {
    rowKey,
    delivery: {
      committedTickets: 0,
      committedSP: 0,
      deliveredTickets: 0,
      deliveredSP: 0,
      readyForTestTickets: 0,
      readyForTestSP: 0,
      predictability: null,
      predictabilityRFT: null,
      newTickets: 0,
      newSP: 0,
      predictabilityNew: null,
    },
    deliveryJiraLinks: { committed: '', delivered: '', readyForTest: '', new: '' },
    quality: { totalBugs: 0, critical: 0, major: 0, minor: 0, prodBug: 0, noRC: 0 },
    qualityJiraLinks: { totalBugs: '', critical: '', major: '', minor: '', prodBug: '', noRC: '' },
    impactAnalysis: { totalTickets: 0, iaGood: 0, iaMissingInfo: 0 },
    impactAnalysisJiraLinks: { iaGood: '', iaMissingInfo: '' },
    sandboxDateBreakdown: {
      ticketsInSprint: 0,
      missingSandboxDate: 0,
      sandboxDateEqualsSprintEnd: 0,
      sandboxDateMinus1: 0,
      sandboxDatePlus1: 0,
      sandboxDatePlus2: 0,
    },
    sandboxDateJiraLinks: { ticketsInSprint: '', missingSandboxDate: '', equalsSprintEnd: '', minus1: '', plus1: '', plus2: '' },
    executiveSummary: { delivery: 'unset', quality: 'unset', impactAnalysis: 'unset', overall: 'unset', commentary: '' },
  };
}

function sampleReport(overrides: Partial<SprintReport> = {}): SprintReport {
  return {
    sprintCode: '26.08.B',
    startDate: '2026/08/06',
    endDate: '2026/08/19',
    labels: ['nhuvth'],
    rows: [sampleRow('PC')],
    deliveryComment: '',
    qualityComment: '',
    impactAnalysisComment: '',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('SprintReportStore', () => {
  it('returns undefined for a sprint code that has never been saved', async () => {
    const store = new SprintReportStore(join(dir, 'sprint-reports.json'));
    expect(await store.get('26.08.B')).toBeUndefined();
  });

  it('saves and retrieves a report by sprint code', async () => {
    const store = new SprintReportStore(join(dir, 'sprint-reports.json'));
    await store.save(sampleReport());
    const loaded = await store.get('26.08.B');
    expect(loaded?.sprintCode).toBe('26.08.B');
    expect(loaded?.rows).toEqual([sampleRow('PC')]);
  });

  it('preserves the original createdAt and bumps updatedAt on a second save', async () => {
    const store = new SprintReportStore(join(dir, 'sprint-reports.json'));
    const first = await store.save(sampleReport({ createdAt: '', updatedAt: '' }));
    const second = await store.save(sampleReport({ createdAt: '', updatedAt: '', deliveryComment: 'updated' }));
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).not.toBe(first.updatedAt);
    expect(second.deliveryComment).toBe('updated');
  });

  it('persists across separate store instances pointed at the same file', async () => {
    const filePath = join(dir, 'sprint-reports.json');
    const first = new SprintReportStore(filePath);
    await first.save(sampleReport());

    const second = new SprintReportStore(filePath);
    expect((await second.get('26.08.B'))?.sprintCode).toBe('26.08.B');
  });
});
