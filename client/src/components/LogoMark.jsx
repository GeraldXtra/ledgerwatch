/**
 * LedgerWatch logo mark — a rounded tile holding an abstract glyph that fuses
 * ledger rows, a rising bar chart, and a "watch" dot capping the tallest bar.
 * Geometric, no text, legible down to 16px. Mirrors client/public/favicon.svg.
 *
 * `tile` and `dot` let a caller recolour the mark; both default to the shipped
 * values, so every existing usage renders exactly as before.
 */
export default function LogoMark({
  size = 32,
  className = "",
  tile = "#16294A",
  dot = "#C0A053",
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`logo-svg ${className}`.trim()}
      role="img"
      aria-label="LedgerWatch"
    >
      <rect width="32" height="32" rx="8" fill={tile} />
      {/* three ascending ledger rows becoming a bar chart */}
      <rect x="8" y="19" width="4" height="6" rx="1.4" fill="#FFFFFF" opacity="0.62" />
      <rect x="14" y="15" width="4" height="10" rx="1.4" fill="#FFFFFF" opacity="0.82" />
      <rect x="20" y="11" width="4" height="14" rx="1.4" fill="#FFFFFF" />
      {/* the watch dot capping the tallest bar */}
      <circle cx="22" cy="7.5" r="2.6" fill={dot} />
    </svg>
  );
}
