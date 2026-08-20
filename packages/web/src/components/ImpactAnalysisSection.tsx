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
              <td>{row.impactAnalysis.totalTickets}</td>
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

      <h3 className="heading-md">Missing Impact Examples</h3>
      {rows.map(
        (row) =>
          row.missingImpact.length > 0 && (
            <div key={row.rowKey}>
              <p className="body-strong">{row.rowKey}</p>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Missing Info</th>
                  </tr>
                </thead>
                <tbody>
                  {row.missingImpact.map((mi, index) => (
                    <tr key={mi.ticket}>
                      <td>{mi.ticket}</td>
                      <td>
                        <input
                          className="text-input"
                          aria-label={`${mi.ticket} missing info`}
                          value={mi.missingInfo}
                          onChange={(e) => {
                            const missingImpact = row.missingImpact.map((m, i) =>
                              i === index ? { ...m, missingInfo: e.target.value } : m
                            );
                            onRowsChange(updateRow(rows, row.rowKey, { missingImpact }));
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      )}
    </section>
  );
}
