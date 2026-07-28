const LABELS = {
  pending: "Pending",
  partially_paid: "Partial",
  overdue: "Overdue",
  paid: "Paid",
  scheduled: "Scheduled",
  sent: "Sent",
  cancelled: "Cancelled",
  buy: "Buy",
  sell: "Sell",
  hold: "Hold",
  approved: "Approved",
  dismissed: "Dismissed",
};

/**
 * Status pill. `status` is one of: pending, overdue, paid, scheduled, sent,
 * cancelled, buy, sell, hold. Re-mounts (keyed by status) so the transition
 * pulse plays when a status flips, e.g. Pending -> Paid.
 */
export default function StatusPill({ status, children }) {
  return (
    <span key={status} className={`pill ${status} pulse`}>
      <span className="pill-dot" />
      {children || LABELS[status] || status}
    </span>
  );
}
