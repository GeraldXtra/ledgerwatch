/**
 * Standard page header stack: eyebrow overline, page title, one supporting
 * line, with an action slot on the right (the view's single primary action).
 */
export default function PageHeader({ eyebrow, title, support, action }) {
  return (
    <div className="page-head">
      <div className="page-head-text">
        {eyebrow && <span className="overline accent">{eyebrow}</span>}
        <h1 className="page-title">{title}</h1>
        {support && <p className="support" style={{ margin: 0 }}>{support}</p>}
      </div>
      {action && <div className="row wrap">{action}</div>}
    </div>
  );
}
