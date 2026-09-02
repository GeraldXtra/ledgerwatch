import { useId } from "react";

/**
 * LedgerWatch logo mark — an engraved crest.
 *
 * WHY A CREST, AND WHY IT LOOKS LIKE THIS
 *
 * The previous mark was a rounded tile holding three ascending bars. That is the
 * default silhouette of roughly every dashboard product of the last decade, and
 * on a screen full of lucide icons it read as one more icon rather than as a
 * brand. This one is deliberately built from a different vocabulary.
 *
 * A shield, because the product's whole promise is custody and trust: it watches
 * money that has already been earned and makes sure somebody notices when it
 * arrives. A crest is the oldest visual shorthand there is for that, and it is
 * the one shape a bank, a notary and a guild all reached for independently.
 *
 * The engraved inner keyline is the detail that stops it feeling like a flat
 * app icon. It is borrowed from banknote and share certificate engraving, where
 * a fine inset rule signals that the document is worth something. It costs one
 * stroke and does most of the work of making the mark feel made rather than
 * generated.
 *
 * Inside: a rising chevron over a gold rule. The rule is the ledger line, the
 * balance being struck. The chevron is money moving up across it. Two marks,
 * both legible at 16px, which a two letter monogram would not be.
 *
 * The navy is a vertical gradient rather than a flat fill, so the plate has
 * depth under a light and a dark ground alike. Colours are the design system's
 * own: navy plus the single gold accent, no third hue.
 */
export default function LogoMark({ size = 32, className = "" }) {
  // Gradient ids must be unique per instance. AuthPage renders two marks on one
  // screen, and duplicate ids make the second one inherit the first's paint.
  const uid = useId().replace(/:/g, "");

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
      <defs>
        <linearGradient id={`lw-plate-${uid}`} x1="32" y1="8" x2="32" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1C3358" />
          <stop offset="1" stopColor="#0A1529" />
        </linearGradient>
        <linearGradient id={`lw-rise-${uid}`} x1="22" y1="34" x2="42" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#E8E2D2" />
        </linearGradient>
      </defs>

      {/* The crest. Straight shoulders, rounded top corners, tapering to a point. */}
      <path
        d="M14 9H50A4 4 0 0 1 54 13V33C54 41 48 52 32 59.5C16 52 10 41 10 33V13A4 4 0 0 1 14 9Z"
        fill={`url(#lw-plate-${uid})`}
      />

      {/* Engraved keyline, inset. The detail that makes it a seal, not an icon. */}
      <path
        d="M17 12.4H47A3 3 0 0 1 50.6 15.4V33C50.6 40.5 45.4 50 32 55.6C18.6 50 13.4 40.5 13.4 33V15.4A3 3 0 0 1 17 12.4Z"
        stroke="#C0A053"
        strokeWidth="1.15"
        strokeOpacity="0.62"
      />

      {/* Money rising across the ledger line. */}
      <path
        d="M21.8 34L32 23.2L42.2 34"
        stroke={`url(#lw-rise-${uid})`}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* The ledger rule — the balance being struck. The one gold accent. */}
      <path d="M22.5 42H41.5" stroke="#C0A053" strokeWidth="3.2" strokeLinecap="round" />

    </svg>
  );
}
