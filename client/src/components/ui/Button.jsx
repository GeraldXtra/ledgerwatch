const VARIANT = {
  default: "btn",
  primary: "btn btn-primary",
  ghost: "btn btn-ghost",
  danger: "btn btn-danger",
};

/**
 * Button with strict hierarchy. `variant`: default | primary | ghost | danger.
 * `icon` renders a square icon-only button; `size="sm"` for row actions;
 * `block` makes it full-width; `loading` shows a spinner and disables it.
 * Renders an <a> when `href` is given (e.g. the WhatsApp action).
 */
export default function Button({
  variant = "default",
  size,
  icon = false,
  block = false,
  loading = false,
  href,
  className = "",
  disabled,
  children,
  ...rest
}) {
  const cls = [
    VARIANT[variant] || VARIANT.default,
    size === "sm" ? "btn-sm" : "",
    icon ? "btn-icon" : "",
    block ? "btn-block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const content = loading ? (
    <>
      <span className="spinner" aria-hidden="true" />
      {children}
    </>
  ) : (
    children
  );

  /**
   * A DISABLED LINK BUTTON USED TO BE A WORKING ONE.
   *
   * The link branch dropped `disabled` entirely — it is destructured out of the
   * props above, so it was neither applied nor turned into `aria-disabled`, and
   * a caller asking for a disabled button got a fully clickable anchor. Nothing
   * pairs `href` with `disabled` today, so this is latent; the place it would
   * first be used is a money screen (an explorer link on a transaction that is
   * still broadcasting), where a click during the broadcast is exactly what is
   * meant to be prevented.
   *
   * A disabled one renders as a real `<button disabled>` rather than as an
   * anchor wearing a disabled class: nothing to navigate to is the honest shape
   * of "this link is not available yet", it cannot be clicked or tabbed to, and
   * it picks up the same disabled styling every other button has.
   */
  if (href && !(disabled || loading)) {
    return (
      <a className={cls} href={href} {...rest}>
        {content}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {content}
    </button>
  );
}
