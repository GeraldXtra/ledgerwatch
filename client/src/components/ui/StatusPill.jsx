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

export default function StatusPill({ status, children }) {
  return (
    <span key={status} className={`pill ${status} pulse`}>
      <span className="pill-dot" />
      {children || LABELS[status] || status}
    </span>
  );
}
