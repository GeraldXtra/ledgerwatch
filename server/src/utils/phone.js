function normalizePhone(raw) {
  if (!raw || typeof raw !== "string") {
    return { valid: false, intl: null };
  }

  const digits = raw.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("0")) {
    return { valid: true, intl: "234" + digits.slice(1) };
  }

  if (digits.length === 13 && digits.startsWith("234")) {
    return { valid: true, intl: digits };
  }

  if (digits.length >= 10 && digits.length <= 15) {
    return { valid: true, intl: digits };
  }

  return { valid: false, intl: null };
}

module.exports = { normalizePhone };
