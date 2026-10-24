export const MIN_WALLET_PASSWORD = 12;

const OBVIOUS = [
  "password",
  "passw0rd",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyuiop",
  "letmein",
  "iloveyou",
  "admin123",
  "welcome1",
  "ledgerwatch",
  "mywalletpassword",
  "walletpassword",
  "cryptowallet",
  "demo1234",
];

const RUNS = [
  "abcdefghijklmnopqrstuvwxyz",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
  "01234567890",
];

function hasStraightRun(lower, len = 6) {
  for (const row of RUNS) {
    for (let i = 0; i + len <= row.length; i++) {
      const seq = row.slice(i, i + len);
      if (lower.includes(seq)) return true;
      const back = seq.split("").reverse().join("");
      if (lower.includes(back)) return true;
    }
  }
  return false;
}

function isRepetitive(value) {
  if (/^(.)\1+$/.test(value)) return true;
  for (let unit = 2; unit <= 4; unit++) {
    if (value.length % unit !== 0) continue;
    const head = value.slice(0, unit);
    if (head.repeat(value.length / unit) === value) return true;
  }
  return false;
}

export function assessWalletPassword(password, context = {}) {
  const value = String(password || "");
  const lower = value.toLowerCase();

  if (!value) {
    return { ok: false, score: 0, label: "Too short", reason: "Choose a password for this wallet." };
  }

  if (value.length < MIN_WALLET_PASSWORD) {
    return {
      ok: false,
      score: 0,
      label: "Too short",
      reason:
        `Use at least ${MIN_WALLET_PASSWORD} characters. This password encrypts your keys on this ` +
        "device and cannot be reset, so it has to survive someone guessing at it offline. " +
        "Three or four unrelated words are easier to remember and far harder to break than a short one.",
    };
  }

  if (OBVIOUS.some((bad) => lower === bad || lower.includes(bad))) {
    return {
      ok: false,
      score: 0,
      label: "Too common",
      reason:
        "That is one of the first passwords anybody tries. Pick something that is not a " +
        "common word or phrase.",
    };
  }

  if (isRepetitive(value)) {
    return {
      ok: false,
      score: 0,
      label: "Too repetitive",
      reason: "That is one short pattern repeated. It is no harder to guess than the pattern itself.",
    };
  }

  if (hasStraightRun(lower)) {
    return {
      ok: false,
      score: 0,
      label: "Too predictable",
      reason: "That contains a straight run of keys or letters, which guessing tools try first.",
    };
  }

  const ownTokens = [
    ...String(context.email || "").split("@")[0].toLowerCase().split(/[^a-z0-9]+/i),
    ...String(context.name || "").toLowerCase().split(/[^a-z0-9]+/i),
  ].filter((t) => t && t.length >= 4);

  for (const own of ownTokens) {
    if (lower.includes(own)) {
      return {
        ok: false,
        score: 1,
        label: "Too personal",
        reason:
          "That contains your own name or email address, which is the first thing someone " +
          "with your keystore would try.",
      };
    }
  }

  const classes =
    (/[a-z]/.test(value) ? 1 : 0) +
    (/[A-Z]/.test(value) ? 1 : 0) +
    (/[0-9]/.test(value) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(value) ? 1 : 0);
  const distinct = new Set(value).size;

  let score = 2;
  if (value.length >= 16 || classes >= 3) score = 3;
  if (value.length >= 20 || (value.length >= 16 && classes >= 3 && distinct >= 12)) score = 4;

  return {
    ok: true,
    score,
    label: score >= 4 ? "Strong" : score === 3 ? "Good" : "Acceptable",
    reason: "",
  };
}
