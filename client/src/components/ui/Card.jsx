/**
 * Surface card. `title` + optional `subtitle` render a standard header with a
 * hairline divider; `eyebrow` adds an uppercase micro-label above the title;
 * `icon` renders a leading tinted tile; `action` sits at the right of the header.
 * `divider={false}` drops the header underline; `hero` gives a more elevated
 * surface. Same core API as before (extra props are optional).
 */
export default function Card({
  title,
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
              {title && <h3 className="card-title">{title}</h3>}
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
