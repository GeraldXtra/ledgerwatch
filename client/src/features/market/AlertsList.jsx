import { BellOff, TrendingDown, TrendingUp, X } from "lucide-react";
import { usd } from "./format";
import { Button, Card, EmptyState, StatusPill } from "../../components/ui";

export default function AlertsList({ alerts, onTrade, onDismiss, busyId }) {
  return (
    <Card
      eyebrow="Your decision"
      title="Alerts awaiting your decision"
      subtitle="The agent recommends; you choose the side and the amount. Nothing executes until you confirm."
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
                  {/* The suggestion is a recommendation, labelled as such — the
                      user is free to take the opposite side. */}
                  <span className="muted small">Agent suggests</span>
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
                  onClick={() => onTrade(a, "buy")}
                >
                  <TrendingUp size={13} /> Buy
                </Button>
                <Button
                  size="sm"
                  disabled={busyId === a._id}
                  onClick={() => onTrade(a, "sell")}
                >
                  <TrendingDown size={13} /> Sell
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
