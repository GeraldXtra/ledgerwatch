const PALETTE = [
  "#16283f",
  "#23405f",
  "#35577c",
  "#b08d3f",
  "#96742b",
  "#cdae6c",
  "#0b6247",
  "#a2362a",
  "#5d5952",
  "#74581a",
];

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
