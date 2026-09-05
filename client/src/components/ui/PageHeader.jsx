import CountUp from "./CountUp";

/**
 * A page opens with its name, one line about it, its actions on the right,
 * and, when it has figures, a strip of them divided by hairlines.
 *
 * Props
 *   title    the page name
 *   support  one line under it. Optional
 *   figures  [{ label, value, countTo, format, tone, note, mark }]
 *            `mark` colours one figure as the headline. One per page.
 *   action   the view's primary action, or a small cluster
 *   eyebrow  accepted and ignored. The navigation already says which section
 *            this is.
 */
export default function PageHeader({ title, support, figures, action }) {
  const hasFigures = Array.isArray(figures) && figures.length > 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          {support && <p className="page-head-desc">{support}</p>}
        </div>
        {action && <div className="page-head-actions">{action}</div>}
      </div>

      {hasFigures && (
        <div className="stat-strip">
          {figures.map((f) => (
            <Figure key={f.label} {...f} />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * One figure in the strip. Exported because the wallet and the market page
 * state totals outside a header and must state them identically.
 *
 * `countTo` animates the value on first mount. The key on the value re-mounts
 * the element when the number changes, so a live update plays once.
 */
export function Figure({ label, value, countTo, format, tone, note, mark }) {
  const toneCls = tone === "pos" ? " pos" : tone === "neg" ? " neg" : "";
  return (
    <div className={mark ? "stat-cell mark" : "stat-cell"}>
      <span className="stat-cell-label">{label}</span>
      <span
        key={countTo != null ? String(countTo) : String(value)}
        className={`stat-cell-value${toneCls}`}
      >
        {countTo != null ? <CountUp to={countTo} format={format} /> : value}
      </span>
      {note && <span className="stat-cell-note">{note}</span>}
    </div>
  );
}
