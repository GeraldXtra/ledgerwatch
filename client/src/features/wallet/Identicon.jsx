/**
 * A deterministic face for an address.
 *
 * WHY THIS EXISTS AT ALL
 *
 * Two addresses on the same screen differ by four visible characters, and people
 * do not read hexadecimal, they pattern match on it. Every serious wallet gives
 * an account a generated mark for that reason: the wrong account is caught by
 * the eye before a transaction is signed, rather than by reading the address
 * back afterwards when it is too late.
 *
 * It is drawn from the address alone, with no network call and no dependency, so
 * the same wallet always wears the same face on every device.
 *
 * The palette is the app's own ink and brass rather than the usual saturated
 * rainbow. It still separates addresses at a glance, and it does not drop a
 * bright random hue into a page that spends its accent carefully.
 */

const PALETTE = [
  "#16283f", // navy 700
  "#23405f", // navy 600
  "#35577c",
  "#b08d3f", // brass 500
  "#96742b",
  "#cdae6c",
  "#0b6247", // positive green
  "#a2362a", // negative red
  "#5d5952", // neutral ink
  "#74581a",
];

/**
 * FNV style hash. Not cryptographic and does not need to be. It only has to be
 * stable across devices and well spread across the low bits, because everything
 * below is chosen with a modulo.
 */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export default function Identicon({ address, size = 22, className = "" }) {
  const seed = hash(String(address || "").toLowerCase());

  // Four independent draws off different bit ranges of the same hash, so the
  // ground, the two shapes and their rotations do not move together.
  const ground = PALETTE[seed % PALETTE.length];
  const a = PALETTE[(seed >>> 5) % PALETTE.length];
  const b = PALETTE[(seed >>> 11) % PALETTE.length];
  const rotA = (seed >>> 17) % 360;
  const rotB = (seed >>> 23) % 360;
  const offset = ((seed >>> 3) % 40) - 20;

  return (
    <svg
      className={`mm-jazz ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Account mark"
      style={{ background: ground }}
    >
      <rect
        x="-20"
        y={22 + offset}
        width="140"
        height="46"
        fill={a}
        opacity="0.95"
        transform={`rotate(${rotA} 50 50)`}
      />
      <circle cx={50 + offset} cy="50" r="26" fill={b} opacity="0.92" />
      <rect
        x="-20"
        y="62"
        width="140"
        height="20"
        fill={a}
        opacity="0.45"
        transform={`rotate(${rotB} 50 50)`}
      />
    </svg>
  );
}
