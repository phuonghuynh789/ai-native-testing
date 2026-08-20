import type { SprintReportRowData } from '../sprintReports';

export interface ImpactAnalysisSectionProps {
  rows: SprintReportRowData[];
  onRowsChange: (rows: SprintReportRowData[]) => void;
}

function updateRow(
  rows: SprintReportRowData[],
  rowKey: SprintReportRowData['rowKey'],
  patch: Partial<SprintReportRowData>
): SprintReportRowData[] {
  return rows.map((row) => (row.rowKey === rowKey ? { ...row, ...patch } : row));
}

export function ImpactAnalysisSection({ rows, onRowsChange }: ImpactAnalysisSectionProps) {
  return (
    <section className="card">
      <h2 className="heading-md">3. Impact Analysis Review</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Squad</th>
            <th>Total Tickets</th>
            <th>IA Good</th>
            <th>IA Missing Info</th>
            <th>IA Wrong Scope</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rowKey}>
              <td>{row.rowKey}</td>
              <td>
                <a href={row.deliveryJiraLinks.readyForTest} target="_blank" rel="noopener noreferrer">
                  {row.impactAnalysis.totalTickets}
                </a>
              </td>
              <td>{row.impactAnalysis.iaGood}</td>
              <td>{row.impactAnalysis.iaMissingInfo}</td>
              <td>
                <input
                  className="text-input"
                  type="number"
                  min={0}
                  aria-label={`${row.rowKey} IA Wrong Scope`}
                  value={row.iaWrongScope}
                  onChange={(e) => onRowsChange(updateRow(rows, row.rowKey, { iaWrongScope: Number(e.target.value) }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
