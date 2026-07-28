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
 * Initials avatar on a rotating soft tint. `size`: "md" (28px) | "lg" (32px).
 */
export default function Avatar({ name, size = "md" }) {
  const cls = [
    "avatar",
    size === "lg" ? "avatar-lg" : "",
    `avatar-t${tintOf(name)}`,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}
