import { History } from "lucide-react";
import { price as fmtPrice } from "./format";
import { Card, EmptyState, StatusPill } from "../../components/ui";

function when(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Past alerts (approved + dismissed) with their outcome — depth beyond the
 * pending list. `alerts` from GET /api/alerts/history.
 */
export default function AlertHistory({ alerts }) {
  return (
    <Card
      eyebrow="History"
      title="Alert history"
      subtitle="Every alert the agent has raised, and what you decided."
    >
      {alerts.length === 0 ? (
        <EmptyState
          icon={<History size={20} />}
          title="No alert history yet"
          hint="Once you approve or dismiss an alert it appears here with its outcome."
        />
      ) : (
        <ul className="plain-list">
          {alerts.map((a) => (
            <li key={a._id} className="alert-history-row list-row">
              <div className="row space-between">
                <div className="row">
                  <span className="coin-chip">{a.symbol}</span>
                  {/* Agent recommendation vs what the user actually did. When
                      they differ the user overrode the agent — worth showing. */}
                  <span className="muted caption">agent</span>
                  <StatusPill status={a.suggestion} />
                  {a.userAction && (
                    <>
                      <span className="muted caption">→ you</span>
                      <StatusPill status={a.userAction === "dismiss" ? "cancelled" : a.userAction} />
                      {a.userAction !== "dismiss" && a.userAction !== a.suggestion && (
                        <span className="override-chip">overrode</span>
                      )}
                    </>
                  )}
                </div>
                <div className="row">
                  <span className="muted small num">{fmtPrice(a.priceAtAlert)}</span>
                  <StatusPill status={a.status} />
                </div>
              </div>
              <div className="muted caption" style={{ marginTop: 4 }}>
                {when(a.createdAt)}
                {a.executedQty != null && (
                  <>
                    {" · "}
                    <span className="num">
                      {a.executedQty.toFixed(6)} {a.symbol}
                    </span>
                    {a.executedValue != null && (
                      <span className="num"> ({fmtPrice(a.executedValue)})</span>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
