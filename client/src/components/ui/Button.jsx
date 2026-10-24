const VARIANT = {
  default: "btn",
  primary: "btn btn-primary",
  ghost: "btn btn-ghost",
  danger: "btn btn-danger",
};

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
