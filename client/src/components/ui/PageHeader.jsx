import CountUp from "./CountUp";

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
