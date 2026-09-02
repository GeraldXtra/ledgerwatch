import CountUp from "./CountUp";

/**
 * THE FOLIO
 *
 * A page opens with its name set large in the serif on the left and the figures
 * that matter on the right, on one baseline, over a rule.
 *
 * This replaced a row of four boxed KPI cards, and it is the single change that
 * most separates this interface from the dashboard template it used to resemble.
 * Four white boxes with tinted icon squares floating on grey is what every admin
 * theme ships with. Figures divided by hairlines is how a ledger has stated its
 * totals for about six hundred years, it is denser, and it puts the page name
 * and its numbers in one glance instead of two.
 *
 * Props
 *   title    the page name
 *   support  one line under it. Optional
 *   figures  [{ label, value, countTo, format, tone, note, mark }]
 *            `mark` gives one figure the brass underscore. One per page.
 *   action   the view's primary action, or a small cluster
 *   eyebrow  accepted and ignored. The rail already says which section this is,
 *            so repeating it above the title was a label nobody read.
 */
export default function PageHeader({ title, support, figures, action }) {
  const hasFigures = Array.isArray(figures) && figures.length > 0;

  return (
    <div className="folio">
      <div className="folio-text">
        <h1 className="folio-title">{title}</h1>
        {support && <p className="folio-note">{support}</p>}
      </div>

      {hasFigures && (
        <div className="folio-figures">
          {figures.map((f) => (
            <Figure key={f.label} {...f} />
          ))}
        </div>
      )}

      {action && <div className="folio-actions">{action}</div>}
    </div>
  );
}

/**
 * One figure in the rail. Exported because the wallet and the market page state
 * totals outside a folio and must state them identically.
 *
 * `countTo` animates the value on first mount. The key on the value re founds the
 * element when the number changes, so a live update plays its own entrance
 * rather than silently swapping digits.
 */
export function Figure({ label, value, countTo, format, tone, note, mark }) {
  const toneCls = tone === "pos" ? " pos" : tone === "neg" ? " neg" : "";
  return (
    <div className={mark ? "lw-figure mark" : "lw-figure"}>
      <span className="lw-figure-label">{label}</span>
      <span
        key={countTo != null ? String(countTo) : String(value)}
        className={`lw-figure-value${toneCls}`}
      >
        {countTo != null ? <CountUp to={countTo} format={format} /> : value}
      </span>
      {note && <span className="lw-figure-note">{note}</span>}
    </div>
  );
}
