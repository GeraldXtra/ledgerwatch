import { BellRing, Check, Eye, PlusCircle } from "lucide-react";
import Reveal from "./Reveal";

const STEPS = [
  { icon: <PlusCircle size={18} />, title: "Add a debt or a coin", body: "Record who owes you, or tell the agent which coin to watch." },
  { icon: <Eye size={18} />, title: "LedgerWatch monitors", body: "It tracks due dates and live prices in the background, around the clock." },
  { icon: <BellRing size={18} />, title: "It drafts the message", body: "A polite reminder with your account details, or an alert explaining the move." },
  { icon: <Check size={18} />, title: "You approve", body: "One tap sends the reminder or accepts the trade. Nothing happens without you." },
];

export default function HowItWorks() {
  return (
    <section className="landing-section" id="how">
      <div className="landing-inner">
        <Reveal className="section-head center">
          <span className="overline">How it works</span>
          <h2 className="h1-landing">Four steps, then it runs itself.</h2>
          <p className="section-sub">
            Set it up once. LedgerWatch does the watching and the writing; you keep the
            final say.
          </p>
        </Reveal>

        <ol className="steps-rail">
          {STEPS.map((s, i) => (
            <Reveal as="li" key={s.title} className="step" delay={i * 90}>
              <span className="step-num">{String(i + 1).padStart(2, "0")}</span>
              <span className="icon-badge">{s.icon}</span>
              <h3 className="card-title">{s.title}</h3>
              <p className="muted small" style={{ margin: 0 }}>
                {s.body}
              </p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
