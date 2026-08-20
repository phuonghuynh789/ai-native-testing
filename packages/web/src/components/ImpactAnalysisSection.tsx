import type { SprintReportRowData } from '../sprintReports';

export interface ImpactAnalysisSectionProps {
  rows: SprintReportRowData[];
}

export function ImpactAnalysisSection({ rows }: ImpactAnalysisSectionProps) {
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
              <td>
                <a href={row.impactAnalysisJiraLinks.iaGood} target="_blank" rel="noopener noreferrer">
                  {row.impactAnalysis.iaGood}
                </a>
              </td>
              <td>
                <a href={row.impactAnalysisJiraLinks.iaMissingInfo} target="_blank" rel="noopener noreferrer">
                  {row.impactAnalysis.iaMissingInfo}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
