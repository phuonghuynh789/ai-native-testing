import type { SprintReportRowData } from '../sprintReports';

export interface ImpactAnalysisSectionProps {
  rows: SprintReportRowData[];
  impactAnalysisComment: string;
  onImpactAnalysisCommentChange: (comment: string) => void;
}

export function ImpactAnalysisSection({
  rows,
  impactAnalysisComment,
  onImpactAnalysisCommentChange,
}: ImpactAnalysisSectionProps) {
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

      <label className="label">
        Nhận xét
        <textarea
          className="text-input"
          value={impactAnalysisComment}
          onChange={(e) => onImpactAnalysisCommentChange(e.target.value)}
        />
      </label>
      <p className="field-hint">
        Gợi ý: nêu rõ những ticket còn thiếu Impact Analysis và lý do, so sánh tỷ lệ IA Good với sprint trước để đánh
        giá xu hướng cải thiện, và đề xuất hành động nếu tỷ lệ IA Missing Info còn cao.
      </p>
    </section>
  );
}
