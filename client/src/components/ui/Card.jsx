export default function Card({
  title,
  count,
  subtitle,
  eyebrow,
  icon,
  action,
  divider = true,
  hero = false,
  className = "",
  children,
}) {
  const cls = ["card", hero ? "hero" : "", className].filter(Boolean).join(" ");
  const headCls = divider ? "card-head" : "card-head plain";
  return (
    <section className={cls}>
      {(title || action) && (
        <div className={headCls}>
          <div className="card-head-main">
            {icon && <span className="icon-tile neutral">{icon}</span>}
            <div>
              {eyebrow && <div className="overline card-eyebrow">{eyebrow}</div>}
              {title && (
                <h3 className="card-title">
                  {title}
                  {count != null && (
                    <>
                      {" "}
                      <span className="page-count num">({count})</span>
                    </>
                  )}
                </h3>
              )}
              {subtitle && <div className="card-sub">{subtitle}</div>}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
