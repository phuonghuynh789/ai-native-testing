import type { SprintReportRowData } from '../sprintReports';

export interface SprintDeliverySummarySectionProps {
  rows: SprintReportRowData[];
  onRowsChange: (rows: SprintReportRowData[]) => void;
  deliveryComment: string;
  onDeliveryCommentChange: (comment: string) => void;
}

function updateRow(
  rows: SprintReportRowData[],
  rowKey: SprintReportRowData['rowKey'],
  patch: Partial<SprintReportRowData>
): SprintReportRowData[] {
  return rows.map((row) => (row.rowKey === rowKey ? { ...row, ...patch } : row));
}

export function SprintDeliverySummarySection({
  rows,
  onRowsChange,
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
              <td>{row.delivery.predictability === null ? '—' : `${(row.delivery.predictability * 100).toFixed(1)}%`}</td>
              <td>{row.delivery.readyForTestTickets}</td>
              <td>{row.delivery.readyForTestSP}</td>
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
      {rows.map(
        (row) =>
          row.rootCause.length > 0 && (
            <div key={row.rowKey}>
              <p className="body-strong">{row.rowKey}</p>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Reason</th>
                    <th>Owner</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {row.rootCause.map((rc, index) => (
                    <tr key={rc.ticket}>
                      <td>{rc.ticket}</td>
                      <td>
                        <input
                          className="text-input"
                          aria-label={`${rc.ticket} reason`}
                          value={rc.reason}
                          onChange={(e) => {
                            const rootCause = row.rootCause.map((r, i) => (i === index ? { ...r, reason: e.target.value } : r));
                            onRowsChange(updateRow(rows, row.rowKey, { rootCause }));
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="text-input"
                          aria-label={`${rc.ticket} owner`}
                          value={rc.owner}
                          onChange={(e) => {
                            const rootCause = row.rootCause.map((r, i) => (i === index ? { ...r, owner: e.target.value } : r));
                            onRowsChange(updateRow(rows, row.rowKey, { rootCause }));
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="text-input"
                          aria-label={`${rc.ticket} action`}
                          value={rc.action}
                          onChange={(e) => {
                            const rootCause = row.rootCause.map((r, i) => (i === index ? { ...r, action: e.target.value } : r));
                            onRowsChange(updateRow(rows, row.rowKey, { rootCause }));
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
