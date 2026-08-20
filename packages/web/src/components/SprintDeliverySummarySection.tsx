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
              <td>
                <JiraLinkCell
                  href={row.sandboxDateJiraLinks.readyOrInTest}
                  value={row.sandboxDateBreakdown.readyOrInTestTickets}
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
    </section>
  );
}
