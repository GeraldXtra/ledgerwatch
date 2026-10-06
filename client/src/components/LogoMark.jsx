export default function LogoMark({ size = 32, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`logo-svg ${className}`.trim()}
      role="img"
      aria-label="LedgerWatch"
    >
      <rect width="64" height="64" rx="16" fill="var(--accent)" />
      <g transform="translate(32 32.4) scale(.74) translate(-32 -32.4)">
        <path
          d="M18 25L27.5 34.5L46 14"
          stroke="var(--on-accent)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M14 44H50M14 52H50" stroke="var(--on-accent)" strokeWidth="5.5" />
      </g>
    </svg>
  );
}
