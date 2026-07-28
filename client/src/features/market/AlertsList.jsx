import { BellOff, Check, X } from "lucide-react";
import { usd } from "./format";
import { Button, Card, EmptyState, StatusPill } from "../../components/ui";

export default function AlertsList({ alerts, onApprove, onDismiss, busyId }) {
  return (
    <Card
      eyebrow="Approvals"
      title="Alerts awaiting approval"
      subtitle="Human-in-the-loop: nothing executes until you approve it."
    >
      {alerts.length === 0 ? (
        <EmptyState
          icon={<BellOff size={20} />}
          title="No pending alerts"
          hint="When a watch condition hits, the agent raises an alert here with a suggestion for your decision."
        />
      ) : (
        <div>
          {alerts.map((a) => (
            <div key={a._id} className="alert-card">
              <div className="row space-between">
                <div className="row">
                  <span className="coin-chip">{a.symbol}</span>
                  <StatusPill status={a.suggestion} />
                </div>
                <span className="muted small num">{usd(a.priceAtAlert)}</span>
              </div>
              <p className="alert-msg">{a.message}</p>
              <div className="row">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busyId === a._id}
                  onClick={() => onApprove(a)}
                >
                  <Check size={13} /> Approve
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyId === a._id}
                  onClick={() => onDismiss(a)}
                >
                  <X size={13} /> Dismiss
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
