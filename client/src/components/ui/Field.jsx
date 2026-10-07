import { Children, cloneElement, isValidElement, useId } from "react";

export function Field({ label, error, children, htmlFor }) {
  const autoId = useId();
  const kids = Children.toArray(children);
  const only = kids.length === 1 && isValidElement(kids[0]) ? kids[0] : null;
  const simple =
    only &&
    (only.type === Input ||
      only.type === Select ||
      only.type === "input" ||
      only.type === "select" ||
      only.type === "textarea");

  const id = htmlFor || (simple ? only.props.id || autoId : undefined);
  const content = simple && !only.props.id && !htmlFor ? cloneElement(only, { id }) : children;

  return (
    <div className="field">
      {label &&
        (id ? (
          <label className="field-label" htmlFor={id}>
            {label}
          </label>
        ) : (
          <span className="field-label">{label}</span>
        ))}
      {content}
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function Input({ className = "", ...rest }) {
  return <input className={`input ${className}`.trim()} {...rest} />;
}

export function Select({ className = "", children, ...rest }) {
  return (
    <span className="select-wrap">
      <select className={`select ${className}`.trim()} {...rest}>
        {children}
      </select>
    </span>
  );
}
