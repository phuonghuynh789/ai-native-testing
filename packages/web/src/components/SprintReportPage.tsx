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
    <main className="app-main">
      <h1 className="heading-xl">Sprint Report</h1>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}

      <section className="card">
        <label className="label">
          Sprint Code
          <input className="text-input" value={sprintCode} onChange={(e) => setSprintCode(e.target.value)} />
        </label>
        <label className="label">
          Start Date
          <input
            className="text-input"
            placeholder="2026/08/06"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label className="label">
          End Date
          <input
            className="text-input"
            placeholder="2026/08/19"
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
            onRowsChange={updateReportRows}
            deliveryComment={report.deliveryComment}
            onDeliveryCommentChange={(deliveryComment) => setReport({ ...report, deliveryComment })}
          />
          <QualityReportSection rows={report.rows} onRowsChange={updateReportRows} />
          <ImpactAnalysisSection rows={report.rows} onRowsChange={updateReportRows} />
          <ExecutiveSummarySection rows={report.rows} onRowsChange={updateReportRows} />
          <button type="button" className="btn-primary" onClick={handleSave}>
            Save
          </button>
        </>
      )}
    </main>
  );
}
