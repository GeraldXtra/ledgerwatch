import { CandlestickChart, LayoutGrid, Receipt } from "lucide-react";

// Purely decorative product visual — real styled markup, not a screenshot. Static
// numbers, marked aria-hidden so screen readers skip the illustration.
const ROWS = [
  { initials: "CO", name: "Chidi Okafor", amount: "NGN 85,000", status: "Overdue", tone: "neg" },
  { initials: "ZB", name: "Zainab Bello", amount: "NGN 30,000", status: "Pending", tone: "neutral" },
  { initials: "EO", name: "Emeka Obi", amount: "NGN 65,000", status: "Paid", tone: "pos" },
];

// A calm, hand-tuned area path so the mini chart always looks intentional.
const AREA = "M0,38 L16,32 L32,35 L48,24 L64,27 L80,16 L96,19 L112,10 L128,13 L144,6";

export default function DashboardMockup() {
  return (
    <div className="mockup" aria-hidden="true">
      <div className="mockup-chrome">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
      </div>

      <div className="mockup-body">
        <aside className="mockup-side">
          <span className="mockup-logo" />
          <span className="mockup-nav active">
            <LayoutGrid size={11} />
          </span>
          <span className="mockup-nav">
            <Receipt size={11} />
          </span>
          <span className="mockup-nav">
            <CandlestickChart size={11} />
          </span>
        </aside>

        <div className="mockup-main">
          <div className="mockup-kpis">
            <div className="mockup-kpi">
              <span className="mk-label">Outstanding</span>
              <span className="mk-value num">NGN 145,000</span>
            </div>
            <div className="mockup-kpi">
              <span className="mk-label">Overdue</span>
              <span className="mk-value num value-neg">2</span>
            </div>
            <div className="mockup-kpi">
              <span className="mk-label">Collected</span>
              <span className="mk-value num value-pos">NGN 197,000</span>
            </div>
          </div>

          <div className="mockup-chart">
            <svg viewBox="0 0 144 44" preserveAspectRatio="none">
              <defs>
                <linearGradient id="mkFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#C0A053" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#C0A053" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={`${AREA} L144,44 L0,44 Z`} fill="url(#mkFill)" />
              <path d={AREA} fill="none" stroke="#C0A053" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>

          <div className="mockup-rows">
            {ROWS.map((r) => (
              <div key={r.initials} className="mockup-row">
                <span className="mockup-avatar">{r.initials}</span>
                <span className="mockup-name">{r.name}</span>
                <span className="mockup-amt num">{r.amount}</span>
                <span className={`mockup-pill ${r.tone}`}>{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
