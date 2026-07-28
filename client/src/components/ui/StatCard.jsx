import CountUp from "./CountUp";

/**
 * KPI stat: an icon tile + optional delta chip on top, then an overline label
 * and a large tabular figure. `countTo` (+ optional `format`) animates the value
 * on first mount; otherwise pass a preformatted `value`. `tone` ("pos"|"neg")
 * colors the figure; `iconTone` ("accent"|"neutral"|"pos"|"neg") tints the tile;
 * `delta` = { text, dir } renders a small chip. Value re-mounts on change so the
 * soft flash plays when a live number updates.
 */
export default function StatCard({
  label,
  value,
  countTo,
  format,
  tone,
  icon,
  iconTone = "accent",
  hint,
  delta,
}) {
  const toneCls = tone === "pos" ? "value-pos" : tone === "neg" ? "value-neg" : "";
  const tileCls = iconTone === "accent" ? "icon-tile" : `icon-tile ${iconTone}`;
  return (
    <div className="stat-card">
      <div className="stat-top">
        {icon && <span className={tileCls}>{icon}</span>}
        {delta && (
          <span className={`delta-chip ${delta.dir || ""}`.trim()}>{delta.text}</span>
        )}
      </div>
      <div className="stat-body">
        <span className="overline">{label}</span>
        <span
          key={countTo != null ? String(countTo) : String(value)}
          className={`stat-value pulse ${toneCls}`.trim()}
        >
          {countTo != null ? <CountUp to={countTo} format={format} /> : value}
        </span>
        {hint && <span className="stat-hint">{hint}</span>}
      </div>
    </div>
  );
}
