import type { SprintReportRowData } from '../sprintReports';

export interface SprintDeliverySummarySectionProps {
  rows: SprintReportRowData[];
  deliveryComment: string;
  onDeliveryCommentChange: (comment: string) => void;
}

function formatPredictability(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function JiraLinkCell({ href, value }: { href: string; value: number }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {value}
    </a>
  );
}

export function SprintDeliverySummarySection({
  rows,
  deliveryComment,
  onDeliveryCommentChange,
}: SprintDeliverySummarySectionProps) {
  return (
    <section className="card">
      <h2 className="heading-md">1. Sprint Delivery Summary</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Squad</th>
            <th>Committed Tickets</th>
            <th>Committed SP</th>
            <th>Delivered Tickets</th>
            <th>Delivered SP</th>
            <th>Predictability</th>
            <th>Ready for Test Tickets</th>
            <th>Ready for Test SP</th>
            <th>Predictability RFT</th>
            <th>New Tickets</th>
            <th>New SP</th>
            <th>Predictability New</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rowKey}>
              <td>{row.rowKey}</td>
              <td>
                <JiraLinkCell href={row.deliveryJiraLinks.committed} value={row.delivery.committedTickets} />
              </td>
              <td>
                <JiraLinkCell href={row.deliveryJiraLinks.committed} value={row.delivery.committedSP} />
              </td>
              <td>
                <JiraLinkCell href={row.deliveryJiraLinks.delivered} value={row.delivery.deliveredTickets} />
              </td>
              <td>
                <JiraLinkCell href={row.deliveryJiraLinks.delivered} value={row.delivery.deliveredSP} />
              </td>
              <td>{formatPredictability(row.delivery.predictability)}</td>
              <td>
                <JiraLinkCell href={row.deliveryJiraLinks.readyForTest} value={row.delivery.readyForTestTickets} />
              </td>
              <td>
                <JiraLinkCell href={row.deliveryJiraLinks.readyForTest} value={row.delivery.readyForTestSP} />
              </td>
              <td>{formatPredictability(row.delivery.predictabilityRFT)}</td>
              <td>
                <JiraLinkCell href={row.deliveryJiraLinks.new} value={row.delivery.newTickets} />
              </td>
              <td>
                <JiraLinkCell href={row.deliveryJiraLinks.new} value={row.delivery.newSP} />
              </td>
              <td>{formatPredictability(row.delivery.predictabilityNew)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <label className="label">
        Nhận xét
        <textarea
          className="text-input"
          value={deliveryComment}
          onChange={(e) => onDeliveryCommentChange(e.target.value)}
        />
      </label>
      <p className="field-hint">Gợi ý:</p>
      <ul className="field-hint">
        <li>
          Nêu nguyên nhân cụ thể gây chênh lệch giữa Committed và Delivered (thiếu nguồn lực, phụ thuộc bị block, thay
          đổi phạm vi) — nêu rõ mã ticket nếu có.
        </li>
        <li>
          So sánh Predictability, Predictability RFT và Predictability New với các sprint trước để chỉ ra xu hướng
          tăng/giảm, không chỉ nêu con số của sprint hiện tại.
        </li>
        <li>
          Nếu Predictability RFT cao hơn hẳn Predictability, phần lớn ticket có thể đang chờ ở bước QA/release hơn là
          chưa hoàn thành phát triển — đáng để giải thích rõ.
        </li>
        <li>
          Giải thích nguồn gốc và lý do phát sinh của các ticket New giữa sprint (hotfix, yêu cầu gấp, đổi ưu tiên) và
          tác động của nó đến năng lực đội trong sprint kế tiếp.
        </li>
      </ul>

      <h3 className="heading-md">Root Cause Tickets Trễ</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Squad</th>
            <th>Tickets in Sprint</th>
            <th>Sandbox Date is EMPTY</th>
            <th>Ticket created mid-sprint</th>
            <th>Sandbox Date = Close Sprint</th>
            <th>Close Sprint Date - 1</th>
            <th>Close Sprint Date + 1</th>
            <th>Close Sprint Date + 2</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rowKey}>
              <td>{row.rowKey}</td>
              <td>
                <JiraLinkCell
                  href={row.sandboxDateJiraLinks.ticketsInSprint}
                  value={row.sandboxDateBreakdown.ticketsInSprint}
                />
              </td>
              <td>
                <JiraLinkCell
                  href={row.sandboxDateJiraLinks.missingSandboxDate}
                  value={row.sandboxDateBreakdown.missingSandboxDate}
                />
              </td>
              <td>
                <JiraLinkCell
                  href={row.sandboxDateJiraLinks.createdMidSprint}
                  value={row.sandboxDateBreakdown.ticketsCreatedMidSprint}
                />
              </td>
              <td>
                <JiraLinkCell
                  href={row.sandboxDateJiraLinks.equalsSprintEnd}
                  value={row.sandboxDateBreakdown.sandboxDateEqualsSprintEnd}
                />
              </td>
              <td>
                <JiraLinkCell href={row.sandboxDateJiraLinks.minus1} value={row.sandboxDateBreakdown.sandboxDateMinus1} />
              </td>
              <td>
                <JiraLinkCell href={row.sandboxDateJiraLinks.plus1} value={row.sandboxDateBreakdown.sandboxDatePlus1} />
              </td>
              <td>
                <JiraLinkCell href={row.sandboxDateJiraLinks.plus2} value={row.sandboxDateBreakdown.sandboxDatePlus2} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="field-hint">Gợi ý:</p>
      <ul className="field-hint">
        <li>
          Nêu rõ những ticket còn thiếu Sandbox Date và nhắc DEV bổ sung trước hạn, nếu không QE sẽ không thể lên kế
          hoạch kiểm thử.
        </li>
        <li>
          Cảnh báo các ticket có Sandbox Date rơi vào Close Sprint Date + 1/+2 — nhóm này có nguy cơ không kịp lên
          Sandbox trước khi đóng sprint.
        </li>
        <li>
          Với nhóm Sandbox Date = Close Sprint, đây là nhóm rủi ro cao nhất vì không còn thời gian dự phòng — đề xuất
          theo dõi sát tiến độ từng ngày.
        </li>
        <li>
          Nếu số lượng ticket trễ lặp lại ở cùng một squad qua nhiều sprint, nên đưa vào retro như một vấn đề về quy
          trình thay vì xử lý đơn lẻ từng ticket.
        </li>
      </ul>
    </section>
  );
}
