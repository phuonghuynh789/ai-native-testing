import type { SprintReportRowData } from '../sprintReports';

export interface SprintDeliverySummarySectionProps {
  rows: SprintReportRowData[];
  deliveryComment: string;
  onDeliveryCommentChange: (comment: string) => void;
}

function formatPredictability(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
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
              <td>{row.delivery.committedTickets}</td>
              <td>{row.delivery.committedSP}</td>
              <td>{row.delivery.deliveredTickets}</td>
              <td>{row.delivery.deliveredSP}</td>
              <td>{formatPredictability(row.delivery.predictability)}</td>
              <td>{row.delivery.readyForTestTickets}</td>
              <td>{row.delivery.readyForTestSP}</td>
              <td>{formatPredictability(row.delivery.predictabilityRFT)}</td>
              <td>{row.delivery.newTickets}</td>
              <td>{row.delivery.newSP}</td>
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

      <h3 className="heading-md">Root Cause Tickets Trễ</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Squad</th>
            <th>Ready for Testing or In Test Tickets</th>
            <th>Sandbox Date</th>
            <th>Sandbox Date = Close Sprint</th>
            <th>Sandbox Date - 1</th>
            <th>Sandbox Date + 1</th>
            <th>Sandbox Date + 2</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rowKey}>
              <td>{row.rowKey}</td>
              <td>{row.sandboxDateBreakdown.readyOrInTestTickets}</td>
              <td>{row.sandboxDateBreakdown.missingSandboxDate}</td>
              <td>{row.sandboxDateBreakdown.sandboxDateEqualsSprintEnd}</td>
              <td>{row.sandboxDateBreakdown.sandboxDateMinus1}</td>
              <td>{row.sandboxDateBreakdown.sandboxDatePlus1}</td>
              <td>{row.sandboxDateBreakdown.sandboxDatePlus2}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
