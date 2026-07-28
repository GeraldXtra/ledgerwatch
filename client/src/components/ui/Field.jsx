/**
 * Label-over-control form field. Pass `label`, optional `error`, and either
 * use the built-in input (default) or `as="select"` with children.
 */
export function Field({ label, error, children }) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      {children}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function Input({ className = "", ...rest }) {
  return <input className={`input ${className}`.trim()} {...rest} />;
}

export function Select({ className = "", children, ...rest }) {
  return (
    <select className={`select ${className}`.trim()} {...rest}>
      {children}
    </select>
  );
}
