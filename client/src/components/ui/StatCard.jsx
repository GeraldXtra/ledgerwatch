import CountUp from "./CountUp";

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
