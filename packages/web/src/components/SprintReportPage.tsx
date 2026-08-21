import { useState } from 'react';
import {
  fetchSprintReport,
  refreshSprintReport,
  saveSprintReport,
  type SprintReport,
  type SprintReportRowData,
} from '../sprintReports';
import { SprintDeliverySummarySection } from './SprintDeliverySummarySection';
import { QualityReportSection } from './QualityReportSection';
import { ImpactAnalysisSection } from './ImpactAnalysisSection';
import { ExecutiveSummarySection } from './ExecutiveSummarySection';

const SPRINT_CODE_OPTIONS = [
  '26.01.A',
  '26.01.B',
  '26.02.A',
  '26.02.B',
  '26.03.A',
  '26.03.B',
  '26.04.A',
  '26.04.B',
  '26.04.C',
  '26.05.A',
  '26.05.B',
  '26.06.A',
  '26.06.B',
  '26.07.A',
  '26.07.B',
  '26.08.A',
  '26.08.B',
  '26.09.A',
  '26.09.B',
  '26.09.C',
  '26.10.A',
  '26.10.B',
  '26.11.A',
  '26.11.B',
  '26.12.A',
  '26.12.B',
];

export function SprintReportPage() {
  const [sprintCode, setSprintCode] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [labelsInput, setLabelsInput] = useState('');
  const [report, setReport] = useState<SprintReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const labels = labelsInput
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label !== '');

  async function handleLoad() {
    setError(null);
    const existing = await fetchSprintReport(sprintCode);
    if (existing) {
      setReport(existing);
      setStartDate(existing.startDate);
      setEndDate(existing.endDate);
      setLabelsInput(existing.labels.join(', '));
    } else {
      setError(`No saved report found for "${sprintCode}".`);
    }
  }

  async function handleGenerate() {
    setError(null);
    try {
      const refreshed = await refreshSprintReport(sprintCode, { startDate, endDate, labels });
      setReport(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSave() {
    if (!report) {
      return;
    }
    setError(null);
    try {
      const saved = await saveSprintReport(report);
      setReport(saved);
    } catch {
      setError('Could not save the sprint report.');
    }
  }

  function updateReportRows(rows: SprintReportRowData[]) {
    if (report) {
      setReport({ ...report, rows });
    }
  }

  return (
    <main className="app-main app-main--wide">
      <h1 className="heading-xl">Sprint Report</h1>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}

      <section className="card card--narrow">
        <label className="label">
          Sprint Code
          <input
            className="text-input"
            list="sprint-code-options"
            value={sprintCode}
            onChange={(e) => setSprintCode(e.target.value)}
          />
          <datalist id="sprint-code-options">
            {SPRINT_CODE_OPTIONS.map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
        </label>
        <label className="label">
          Start Date
          <input
            className="text-input"
            placeholder="YYYY/MM/DD"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label className="label">
          End Date
          <input
            className="text-input"
            placeholder="YYYY/MM/DD"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
        <label className="label">
          Labels
          <input
            className="text-input"
            placeholder="nhuvth, minh2, ..."
            value={labelsInput}
            onChange={(e) => setLabelsInput(e.target.value)}
          />
        </label>
        <button type="button" className="btn-secondary" disabled={sprintCode.trim() === ''} onClick={handleLoad}>
          Load Saved
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={sprintCode.trim() === '' || startDate.trim() === '' || endDate.trim() === ''}
          onClick={handleGenerate}
        >
          Generate
        </button>
      </section>

      {report && (
        <>
          <SprintDeliverySummarySection
            rows={report.rows}
            deliveryComment={report.deliveryComment}
            onDeliveryCommentChange={(deliveryComment) => setReport({ ...report, deliveryComment })}
          />
          <QualityReportSection
            rows={report.rows}
            qualityComment={report.qualityComment ?? ''}
            onQualityCommentChange={(qualityComment) => setReport({ ...report, qualityComment })}
          />
          <ImpactAnalysisSection
            rows={report.rows}
            impactAnalysisComment={report.impactAnalysisComment ?? ''}
            onImpactAnalysisCommentChange={(impactAnalysisComment) => setReport({ ...report, impactAnalysisComment })}
          />
          <ExecutiveSummarySection rows={report.rows} onRowsChange={updateReportRows} />
          <button type="button" className="btn-primary" onClick={handleSave}>
            Save
          </button>
        </>
      )}
    </main>
  );
}
