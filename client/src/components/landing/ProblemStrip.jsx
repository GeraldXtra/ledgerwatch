import { Clock, MessageSquare, Moon } from "lucide-react";
import Reveal from "./Reveal";

const PROBLEMS = [
  {
    icon: <Clock size={18} />,
    title: "Debts get forgotten",
    body: "You sold on credit weeks ago. The invoice is in a notebook, and nobody has chased it.",
  },
  {
    icon: <MessageSquare size={18} />,
    title: "Chasing feels awkward",
    body: "Asking a customer for money is uncomfortable, so the message never gets sent.",
  },
  {
    icon: <Moon size={18} />,
    title: "Markets move while you sleep",
    body: "The dip you were waiting for happened at 3am, and you found out the next morning.",
  },
];

export default function ProblemStrip() {
  return (
    <section className="landing-band">
      <div className="landing-inner">
        <Reveal className="section-head">
          <span className="overline">The problem</span>
          <h2 className="h1-landing">Money slips through the cracks.</h2>
          <p className="section-sub">
            Not because you are careless, but because running a business leaves no time to
            watch everything at once.
          </p>
        </Reveal>

        <div className="problem-grid">
          {PROBLEMS.map((p, i) => (
            <Reveal key={p.title} className="problem-card" delay={i * 80}>
              <span className="icon-badge">{p.icon}</span>
              <h3 className="card-title">{p.title}</h3>
              <p className="muted small" style={{ margin: 0 }}>
                {p.body}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
