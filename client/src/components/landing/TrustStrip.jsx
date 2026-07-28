import { Lock, ShieldCheck, WifiOff } from "lucide-react";
import Reveal from "./Reveal";

const TRUST = [
  {
    icon: <ShieldCheck size={18} />,
    title: "Human-in-the-loop by design",
    body: "The agent prepares and suggests. It never sends money or executes a trade on its own.",
  },
  {
    icon: <WifiOff size={18} />,
    title: "Works without AI",
    body: "Every feature falls back to plain templates and rules, so it keeps working if the AI is off.",
  },
  {
    icon: <Lock size={18} />,
    title: "Your data stays yours",
    body: "Your ledger lives in your own database. Trading is simulated, so no real funds are ever at risk.",
  },
];

export default function TrustStrip() {
  return (
    <section className="landing-band">
      <div className="landing-inner">
        <Reveal className="section-head center">
          <span className="overline">Built to be trusted</span>
          <h2 className="h1-landing">Safe by default.</h2>
        </Reveal>

        <div className="trust-grid">
          {TRUST.map((t, i) => (
            <Reveal key={t.title} className="trust-item" delay={i * 80}>
              <span className="icon-badge">{t.icon}</span>
              <h3 className="card-title">{t.title}</h3>
              <p className="muted small" style={{ margin: 0 }}>
                {t.body}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
