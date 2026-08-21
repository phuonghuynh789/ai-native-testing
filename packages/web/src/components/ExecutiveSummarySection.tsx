import type { SprintReportRowData } from '../sprintReports';

export interface ExecutiveSummarySectionProps {
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

const DELIVERY_OPTIONS = ['unset', 'good', 'bad'] as const;
const QUALITY_OPTIONS = ['unset', 'good', 'bad'] as const;
const IMPACT_ANALYSIS_OPTIONS = ['unset', 'good', 'partial', 'bad'] as const;
const OVERALL_OPTIONS = ['unset', 'good', 'medium', 'bad'] as const;

export function ExecutiveSummarySection({ rows, onRowsChange }: ExecutiveSummarySectionProps) {
  return (
    <section className="card">
      <h2 className="heading-md">4. Executive Summary (Quan trọng nhất)</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Squad</th>
            <th>Delivery</th>
            <th>Quality</th>
            <th>Impact Analysis</th>
            <th>Overall</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rowKey}>
              <td>{row.rowKey}</td>
              <td>
                <select
                  className="text-input"
                  aria-label={`${row.rowKey} executive delivery`}
                  value={row.executiveSummary.delivery}
                  onChange={(e) =>
                    onRowsChange(
                      updateRow(rows, row.rowKey, {
                        executiveSummary: { ...row.executiveSummary, delivery: e.target.value as (typeof DELIVERY_OPTIONS)[number] },
                      })
                    )
                  }
                >
                  {DELIVERY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  className="text-input"
                  aria-label={`${row.rowKey} executive quality`}
                  value={row.executiveSummary.quality}
                  onChange={(e) =>
                    onRowsChange(
                      updateRow(rows, row.rowKey, {
                        executiveSummary: { ...row.executiveSummary, quality: e.target.value as (typeof QUALITY_OPTIONS)[number] },
                      })
                    )
                  }
                >
                  {QUALITY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  className="text-input"
                  aria-label={`${row.rowKey} executive impact analysis`}
                  value={row.executiveSummary.impactAnalysis}
                  onChange={(e) =>
                    onRowsChange(
                      updateRow(rows, row.rowKey, {
                        executiveSummary: {
                          ...row.executiveSummary,
                          impactAnalysis: e.target.value as (typeof IMPACT_ANALYSIS_OPTIONS)[number],
                        },
                      })
                    )
                  }
                >
                  {IMPACT_ANALYSIS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  className="text-input"
                  aria-label={`${row.rowKey} executive overall`}
                  value={row.executiveSummary.overall}
                  onChange={(e) =>
                    onRowsChange(
                      updateRow(rows, row.rowKey, {
                        executiveSummary: { ...row.executiveSummary, overall: e.target.value as (typeof OVERALL_OPTIONS)[number] },
                      })
                    )
                  }
                >
                  {OVERALL_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="field-hint">Gợi ý:</p>
      <ul className="field-hint">
        <li>
          Đưa ra kết luận tổng thể (Overall) dựa trên cả 3 chỉ số Delivery/Quality/Impact Analysis, không lặp lại số
          liệu đã có trong các bảng phía trên.
        </li>
        <li>
          Nêu rõ rủi ro cần theo dõi ở sprint tiếp theo (phụ thuộc chưa xử lý, nợ kỹ thuật, nguồn lực) thay vì chỉ mô
          tả những gì đã xảy ra.
        </li>
        <li>Nếu Overall là Yellow hoặc Red, chỉ rõ hành động khắc phục cụ thể và người phụ trách theo dõi.</li>
        <li>
          Nếu Overall là Green, vẫn nên ghi nhận thực hành tốt cần duy trì, thay vì chỉ ghi "không có vấn đề".
        </li>
      </ul>

      {rows.map((row) => (
        <label className="label" key={row.rowKey}>
          {row.rowKey} commentary
          <textarea
            className="text-input"
            aria-label={`${row.rowKey} commentary`}
            value={row.executiveSummary.commentary}
            onChange={(e) =>
              onRowsChange(
                updateRow(rows, row.rowKey, {
                  executiveSummary: { ...row.executiveSummary, commentary: e.target.value },
                })
              )
            }
          />
        </label>
      ))}
    </section>
  );
}
