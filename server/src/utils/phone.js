/**
 * Normalize a phone number to an international format usable by wa.me.
 * Handles Nigerian local numbers (0XXXXXXXXXX -> 234XXXXXXXXXX), +234 / 234
 * numbers, and generic international numbers (10–15 digits).
 *
 * @param {string} raw
 * @returns {{ valid: boolean, intl: string|null }}
 *   intl is digits-only (no leading +), suitable for https://wa.me/<intl>.
 */
function normalizePhone(raw) {
  if (!raw || typeof raw !== "string") {
    return { valid: false, intl: null };
  }

  // Keep digits only (drop +, spaces, dashes, parens, etc.).
  const digits = raw.replace(/\D/g, "");

  // Nigerian local: 0XXXXXXXXXX (11 digits) -> 234XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith("0")) {
    return { valid: true, intl: "234" + digits.slice(1) };
  }

  // Nigerian international: 234XXXXXXXXXX (13 digits)
  if (digits.length === 13 && digits.startsWith("234")) {
    return { valid: true, intl: digits };
  }

  // Generic international fallback: 10–15 digits.
  if (digits.length >= 10 && digits.length <= 15) {
    return { valid: true, intl: digits };
  }

  return { valid: false, intl: null };
}

module.exports = { normalizePhone };
