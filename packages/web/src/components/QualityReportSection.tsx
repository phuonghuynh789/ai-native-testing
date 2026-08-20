import type { SprintReportRowData } from '../sprintReports';

export interface QualityReportSectionProps {
  rows: SprintReportRowData[];
  onRowsChange: (rows: SprintReportRowData[]) => void;
}

const TRI_STATE_OPTIONS = ['unset', 'pass', 'fail'] as const;
const CHECKLIST_CRITERIA = ['noCriticalBug', 'noProductionBug', 'reopenRateUnder10', 'uatStable'] as const;

function updateRow(
  rows: SprintReportRowData[],
  rowKey: SprintReportRowData['rowKey'],
  patch: Partial<SprintReportRowData>
): SprintReportRowData[] {
  return rows.map((row) => (row.rowKey === rowKey ? { ...row, ...patch } : row));
}

export function QualityReportSection({ rows, onRowsChange }: QualityReportSectionProps) {
  return (
    <section className="card">
      <h2 className="heading-md">2. Quality Report</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Squad</th>
            <th>Total Bugs</th>
            <th>Critical</th>
            <th>Major</th>
            <th>Minor</th>
            <th>Prod Bug</th>
            <th>Assessment</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rowKey}>
              <td>{row.rowKey}</td>
              <td>
                <a href={row.qualityJiraLinks.totalBugs} target="_blank" rel="noopener noreferrer">
                  {row.quality.totalBugs}
                </a>
              </td>
              <td>
                <a href={row.qualityJiraLinks.critical} target="_blank" rel="noopener noreferrer">
                  {row.quality.critical}
                </a>
              </td>
              <td>
                <a href={row.qualityJiraLinks.major} target="_blank" rel="noopener noreferrer">
                  {row.quality.major}
                </a>
              </td>
              <td>
                <a href={row.qualityJiraLinks.minor} target="_blank" rel="noopener noreferrer">
                  {row.quality.minor}
                </a>
              </td>
              <td>
                <a href={row.qualityJiraLinks.prodBug} target="_blank" rel="noopener noreferrer">
                  {row.quality.prodBug}
                </a>
              </td>
              <td>
                <select
                  className="text-input"
                  aria-label={`${row.rowKey} assessment`}
                  value={row.qualityChecklist.assessment}
                  onChange={(e) =>
                    onRowsChange(
                      updateRow(rows, row.rowKey, {
                        qualityChecklist: {
                          ...row.qualityChecklist,
                          assessment: e.target.value as SprintReportRowData['qualityChecklist']['assessment'],
                        },
                      })
                    )
                  }
                >
                  <option value="unset">—</option>
                  <option value="good">Good</option>
                  <option value="need-improvement">Need Improvement</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="heading-md">Quality Rating</h3>
      {rows.map((row) => (
        <div key={row.rowKey}>
          <p className="body-strong">{row.rowKey}</p>
          {CHECKLIST_CRITERIA.map((criterion) => (
            <label className="label" key={criterion}>
              {criterion}
              <select
                className="text-input"
                aria-label={`${row.rowKey} ${criterion}`}
                value={row.qualityChecklist[criterion]}
                onChange={(e) =>
                  onRowsChange(
                    updateRow(rows, row.rowKey, {
                      qualityChecklist: { ...row.qualityChecklist, [criterion]: e.target.value },
                    })
                  )
                }
              >
                {TRI_STATE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      ))}
    </section>
  );
}
