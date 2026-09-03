import { Children, cloneElement, isValidElement, useId } from "react";

/**
 * Label-over-control form field.
 *
 * NOT A WRAPPING <label> ANY MORE. It used to render `<label class="field">`
 * around whatever it was given, which is fine for one input and wrong for a
 * composite widget. The coin picker on the market page puts six quick-pick
 * BUTTONS and a search input inside its Field, and a click on any interactive
 * descendant of a label also activates the label's control in WebKit: on an
 * iPhone, tapping the BTC chip focused the search input, which brought the
 * keyboard up and, because the input was under 16px, zoomed the page, while
 * the picker replaced that input with the picked chip underneath the keyboard.
 * The form looked broken and the page looked overlapped. Both were this.
 *
 * So the label is a real <label htmlFor> when the field holds a single
 * input, select or textarea (the id is generated when the caller gave none),
 * and plain text otherwise. Clicking the label still focuses a simple control
 * and screen readers still get the association; a composite widget is left
 * alone.
 */
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
    <select className={`select ${className}`.trim()} {...rest}>
      {children}
    </select>
  );
}
