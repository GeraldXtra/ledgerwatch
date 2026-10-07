import CountUp from "./CountUp";

export default function PageHeader({ title, count, eyebrow, support, figures, action }) {
  const hasFigures = Array.isArray(figures) && figures.length > 0;

  return (
    <>
      <div className="page-head">
        <div className="page-head-main">
          {eyebrow && <div className="page-head-eyebrow">{eyebrow}</div>}
          <h1>
            {title}
            {count != null && (
              <>
                {" "}
                <span className="page-count num">({count})</span>
              </>
            )}
          </h1>
          {support && <p className="page-head-desc">{support}</p>}
        </div>
        {action && <div className="page-head-actions">{action}</div>}
      </div>

      {hasFigures && (
        <section className="stat-strip">
          {figures.map((f) => (
            <Figure key={f.label} {...f} />
          ))}
        </section>
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
