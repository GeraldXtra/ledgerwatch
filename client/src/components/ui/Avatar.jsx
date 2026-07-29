const TINTS = 5;

function initialsOf(name) {
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

// Deterministic tint per name so a debtor keeps their color across renders.
function tintOf(name) {
  let h = 0;
  for (const ch of String(name || "")) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return h % TINTS;
}

/**
 * Avatar. Renders `src` (a profile picture) when one is set and falls back to
 * coloured initials otherwise — the same fallback everywhere avatars appear.
 * `size`: "md" (28px) | "lg" (32px) | "xl" (88px), or an explicit pixel number.
 */
export default function Avatar({ name, src, size = "md" }) {
  const px = typeof size === "number" ? size : { md: 28, lg: 32, xl: 88 }[size] || 28;
  const sized = typeof size === "number" || size === "xl";
  const box = sized ? { width: px, height: px, fontSize: Math.round(px * 0.38) } : undefined;

  if (src) {
    return (
      <img
        className={`avatar avatar-img${size === "lg" ? " avatar-lg" : ""}`}
        src={src}
        alt={name ? `${name}'s profile picture` : "Profile picture"}
        style={box}
      />
    );
  }

  const cls = [
    "avatar",
    size === "lg" ? "avatar-lg" : "",
    `avatar-t${tintOf(name)}`,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls} style={box} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}
