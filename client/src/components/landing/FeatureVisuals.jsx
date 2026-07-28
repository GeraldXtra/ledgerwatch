import { Check, TrendingDown } from "lucide-react";

/** Receivables visual: a debts card with a payment progress bar. */
export function ReceivablesVisual() {
  return (
    <div className="visual-card" aria-hidden="true">
      <div className="visual-head">
        <span className="overline">Debts</span>
        <span className="muted caption">3 open</span>
      </div>

      <div className="visual-row">
        <span className="mockup-avatar">CO</span>
        <div className="grow">
          <div className="bullet-title">Chidi Okafor</div>
          <div className="progress-track sm">
            <span className="progress-fill" style={{ width: "47%" }} />
          </div>
        </div>
        <div className="visual-amt">
          <span className="num mono-strong">NGN 45,000</span>
          <span className="mockup-pill neg">Overdue</span>
        </div>
      </div>

      <div className="visual-row">
        <span className="mockup-avatar t2">TB</span>
        <div className="grow">
          <div className="bullet-title">Tunde Bakare</div>
          <div className="progress-track sm">
            <span className="progress-fill" style={{ width: "42%" }} />
          </div>
        </div>
        <div className="visual-amt">
          <span className="num mono-strong">NGN 70,000</span>
          <span className="mockup-pill neutral">Partial</span>
        </div>
      </div>

      <div className="visual-note">
        <Check size={13} /> Reminder drafted with your account details
      </div>
    </div>
  );
}

/** Market visual: coin rows with a sparkline plus an approve card. */
export function MarketVisual() {
  const spark = "M0,20 L12,16 L24,19 L36,10 L48,13 L60,6 L72,9";
  return (
    <div className="visual-card" aria-hidden="true">
      <div className="visual-head">
        <span className="overline">Watchlist</span>
        <span className="live-indicator">
          <span className="live-dot" />
          Live
        </span>
      </div>

      {[
        { sym: "BTC", price: "$65,532", chg: "-0.70%", tone: "neg" },
        { sym: "ETH", price: "$1,925", chg: "+2.10%", tone: "pos" },
      ].map((c) => (
        <div key={c.sym} className="visual-row">
          <span className="coin-chip">{c.sym}</span>
          <svg className="visual-spark" viewBox="0 0 72 26" preserveAspectRatio="none">
            <path
              d={spark}
              fill="none"
              stroke={c.tone === "pos" ? "var(--pos-text)" : "var(--neg-text)"}
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          <div className="visual-amt">
            <span className="num mono-strong">{c.price}</span>
            <span className={`num caption ${c.tone === "pos" ? "value-pos" : "value-neg"}`}>
              {c.chg}
            </span>
          </div>
        </div>
      ))}

      <div className="visual-alert">
        <div className="row" style={{ gap: 8 }}>
          <span className="icon-badge sm">
            <TrendingDown size={14} />
          </span>
          <div className="grow">
            <div className="bullet-title">BTC dropped 5.2%</div>
            <div className="muted caption">Suggested: buy</div>
          </div>
        </div>
        <span className="visual-approve">Approve</span>
      </div>
    </div>
  );
}
