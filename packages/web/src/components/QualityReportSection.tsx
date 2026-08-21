import type { SprintReportRowData } from '../sprintReports';

export interface QualityReportSectionProps {
  rows: SprintReportRowData[];
  qualityComment: string;
  onQualityCommentChange: (comment: string) => void;
}

export function QualityReportSection({ rows, qualityComment, onQualityCommentChange }: QualityReportSectionProps) {
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
            <th>No RC</th>
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
                <a href={row.qualityJiraLinks.noRC} target="_blank" rel="noopener noreferrer">
                  {row.quality.noRC}
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
          value={qualityComment}
          onChange={(e) => onQualityCommentChange(e.target.value)}
        />
      </label>
      <p className="field-hint">
        Gợi ý: nhận xét tỷ lệ bug theo mức độ nghiêm trọng so với số ticket đã Deliver, nêu nguyên nhân và hướng khắc
        phục các Prod Bug (nếu có), và nhắc các bug còn thiếu Root Cause (No RC) cần bổ sung trước khi đóng sprint.
      </p>
    </section>
  );
}
