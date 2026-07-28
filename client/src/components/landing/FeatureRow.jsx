import Reveal from "./Reveal";

/**
 * Alternating feature row: copy on one side, a visual on the other.
 * `flip` puts the visual first on desktop. `bullets`: [{ icon, title, body }].
 */
export default function FeatureRow({ eyebrow, title, intro, bullets, visual, flip = false, band = false }) {
  return (
    <section className={band ? "landing-band" : "landing-section"}>
      <div className={`landing-inner feature-row ${flip ? "flip" : ""}`.trim()}>
        <Reveal className="feature-copy">
          <span className="overline accent">{eyebrow}</span>
          <h2 className="h1-landing">{title}</h2>
          <p className="section-sub">{intro}</p>
          <ul className="feature-bullets">
            {bullets.map((b) => (
              <li key={b.title}>
                <span className="bullet-icon">{b.icon}</span>
                <div>
                  <div className="bullet-title">{b.title}</div>
                  <div className="muted small">{b.body}</div>
                </div>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal className="feature-visual" delay={90}>
          {visual}
        </Reveal>
      </div>
    </section>
  );
}
