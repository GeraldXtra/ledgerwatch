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
      <rect
        x="15.5"
        y="7.5"
        width="39"
        height="51"
        rx="3.5"
        fill="var(--brand-paper)"
        stroke="var(--brand-ink)"
        strokeWidth="2.4"
      />
      <path
        d="M51.4 14h1.4M51.4 20h1.4M51.4 26h1.4M51.4 32h1.4M51.4 38h1.4M51.4 44h1.4M51.4 50h1.4"
        stroke="var(--brand-rule)"
        strokeWidth="1.1"
      />
      <rect
        x="9.5"
        y="4.5"
        width="40"
        height="51"
        rx="4"
        fill="var(--brand-cover)"
        stroke="var(--brand-ink)"
        strokeWidth="2.4"
      />
      <path d="M17.5 5.2v49.6" stroke="var(--brand-ink)" strokeWidth="2.4" />
      <path
        d="M11 14.5h5M11 30h5M11 45.5h5"
        stroke="var(--brand-ink)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M41.5 5.7h3.8a3 3 0 0 1 3 3v3.8z M48.3 46.5v3.8a3 3 0 0 1-3 3h-3.8z"
        fill="var(--brand-ink)"
      />
      <circle
        cx="33.5"
        cy="28.5"
        r="10.3"
        fill="var(--brand-face)"
        stroke="var(--brand-ink)"
        strokeWidth="2.4"
      />
      <path
        d="M33.5 20.7v1.8M41.3 28.5h-1.8M33.5 36.3v-1.8M25.7 28.5h1.8"
        stroke="var(--brand-ink)"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M33.5 28.5l-4.3-3.1M33.5 28.5l5.4-3.9"
        stroke="var(--brand-ink)"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <circle
        cx="33.5"
        cy="28.5"
        r="1.7"
        fill="var(--brand-cover)"
        stroke="var(--brand-ink)"
        strokeWidth="1"
      />
      <rect x="32" y="15.5" width="3" height="2.8" rx=".8" fill="var(--brand-ink)" />
      <rect
        x="26.5"
        y="44"
        width="14"
        height="5.2"
        rx="1.4"
        fill="var(--brand-paper)"
        stroke="var(--brand-ink)"
        strokeWidth="1.7"
      />
    </svg>
  );
}
