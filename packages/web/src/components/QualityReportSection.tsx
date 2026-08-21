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
      <p className="field-hint">Gợi ý:</p>
      <ul className="field-hint">
        <li>
          So sánh tỷ lệ bug trên số ticket đã Deliver với mức trung bình của các sprint trước để đánh giá chất lượng
          có đang đi lên hay đi xuống.
        </li>
        <li>
          Nhận xét cơ cấu mức độ nghiêm trọng (Critical/Major/Minor) — nếu không có bug Critical/Major, đây là tín
          hiệu tích cực đáng ghi nhận.
        </li>
        <li>Nêu nguyên nhân gốc rễ và hướng khắc phục cụ thể cho từng Prod Bug (nếu có), kèm mã ticket liên quan.</li>
        <li>
          Nhắc các bug còn thiếu Root Cause (No RC) cần bổ sung trước khi đóng sprint; nếu tỷ lệ No RC còn cao qua
          nhiều sprint, đề xuất đưa việc ghi Root Cause thành điều kiện bắt buộc khi đóng bug.
        </li>
      </ul>
    </section>
  );
}
