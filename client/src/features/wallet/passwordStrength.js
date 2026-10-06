/**
 * The strength gate on the one password that cannot be reset.
 *
 * WHY THIS EXISTS
 *
 * Every other password in this product is recoverable: forget the account
 * password and a code arrives by email. The wallet password is not. It is the
 * key-encryption key for a Web3 Secret Storage keystore held in localStorage,
 * and the server has never seen it. Lose it and the funds are gone; guess it and
 * the funds are yours.
 *
 * The threat is OFFLINE. `docs/SECURITY.md` B1 lists "offline brute force of an
 * exfiltrated keystore" as a live risk, because the ciphertext sits in
 * localStorage where any injected script, any malicious extension, or anyone
 * with the unlocked device can read it. Once it is copied there is no rate
 * limit, no lockout and no server involved — only the cost of the KDF and the
 * size of the search space. scrypt at ethers' defaults makes each guess
 * expensive; it does not make a short password safe, it only sets the price.
 *
 * The gate was `password.length < 8` and nothing else. `docs/SECURITY.md` 4.1
 * B1 states the requirement plainly: "MUST raise the password minimum above 8
 * and gate on strength". This is that.
 *
 * WHY LENGTH IS WEIGHTED OVER CHARACTER CLASSES
 *
 * Complexity rules push people toward `Passw0rd!`, which is short and sits in
 * every cracking dictionary. Length is what actually buys search space, so the
 * floor is 12 and the advice asks for words rather than symbols. The class
 * checks below are a nudge on top of that floor, never a substitute for it.
 */

/** The floor. Below this nothing else about the password can rescue it. */
export const MIN_WALLET_PASSWORD = 12;

/**
 * Passwords that appear at the top of every leaked-credential list, plus the
 * ones this product invites by name. Not a real dictionary — a real one belongs
 * on a server and this check runs offline in the browser — but it catches the
 * handful somebody types when they are in a hurry to get to the wallet.
 */
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

/** Characters typed in a straight line. `qwertyui` and `abcdefgh` are not entropy. */
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

/** One character, or one short unit, repeated to reach the length. */
function isRepetitive(value) {
  if (/^(.)\1+$/.test(value)) return true;
  for (let unit = 2; unit <= 4; unit++) {
    if (value.length % unit !== 0) continue;
    const head = value.slice(0, unit);
    if (head.repeat(value.length / unit) === value) return true;
  }
  return false;
}

/**
 * Assess a candidate wallet password.
 *
 * @param {string} password
 * @param {{email?:string, name?:string}} [context] the account's own details,
 *   which are the first thing anybody with the keystore would try.
 * @returns {{ok:boolean, score:0|1|2|3|4, label:string, reason:string}}
 *   `reason` is empty when `ok` is true. It is written to be shown verbatim.
 */
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

  /**
   * The account's own details are the first personalised guess anyone makes.
   *
   * Split into WORDS, not compared whole: "Adaeze Okonkwo" never appears in a
   * password, but "okonkwo" does, and a surname is precisely what somebody
   * reaches for. The email local part is split on its separators for the same
   * reason. Four characters is the floor — below that the token is too common to
   * blocklist without refusing innocent passwords.
   */
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

  // Past the floor. Everything below only grades how much room is left.
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
