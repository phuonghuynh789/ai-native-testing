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
      <p className="field-hint">Gợi ý:</p>
      <ul className="field-hint">
        <li>
          Liệt kê cụ thể những ticket còn thiếu Impact Analysis và lý do (thay đổi nhỏ, rủi ro thấp, thiếu thời gian,
          v.v.), không chỉ nêu số lượng.
        </li>
        <li>
          So sánh tỷ lệ IA Good với sprint trước để đánh giá xu hướng cải thiện hay đi xuống trong việc tuân thủ quy
          trình.
        </li>
        <li>
          Nếu QE phải tự suy luận phạm vi ảnh hưởng từ code thay vì từ mô tả ticket, nên nêu rõ chi phí thời gian phát
          sinh để làm căn cứ cải tiến quy trình.
        </li>
        <li>
          Nếu tỷ lệ IA Missing Info còn cao, đề xuất hành động cụ thể — ví dụ bắt buộc Impact Analysis trong
          Definition of Ready trước khi chuyển sang Ready for Test.
        </li>
        <li>
          Lưu ý: IA Good/IA Missing Info được tính gần đúng qua từ khóa trong mô tả/comment, nên kiểm tra thủ công
          các ticket ở ranh giới trước khi đưa số liệu vào báo cáo cho cấp quản lý.
        </li>
      </ul>
    </section>
  );
}
