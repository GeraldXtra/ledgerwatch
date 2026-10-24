const qs = require("qs");

const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 12;
const MAX_KEYS = 2000;

function parseQuery(str) {
  return qs.parse(str, {
    allowPrototypes: false,
    allowDots: false,
    depth: 3,
    arrayLimit: 100,
    parameterLimit: 200,
  });
}

function inspect(value, depth, state) {
  if (state.problem) return;
  if (depth > MAX_DEPTH) {
    state.problem = "too-deep";
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) inspect(item, depth + 1, state);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    state.keys += 1;
    if (state.keys > MAX_KEYS) {
      state.problem = "too-many";
      return;
    }
    if (key.startsWith("$") || key.includes(".") || RESERVED_KEYS.has(key) || key.includes("\u0000")) {
      state.problem = "reserved";
      state.key = key;
      return;
    }
    inspect(value[key], depth + 1, state);
  }
}

function findProblem(req) {
  for (const part of ["params", "query", "body"]) {
    const state = { problem: null, keys: 0, key: null };
    inspect(req[part], 0, state);
    if (state.problem) return { part, ...state };
  }
  return null;
}

function rejectUnsafeInput(req, res, next) {
  const found = findProblem(req);
  if (!found) return next();
  console.warn(
    `[security] refused ${req.method} ${req.path} from ${req.ip}: ${found.problem} in ${found.part}` +
      (found.key ? ` (key ${JSON.stringify(String(found.key).slice(0, 40))})` : "")
  );
  const error =
    found.problem === "reserved"
      ? "The request contains a field name that is not allowed."
      : found.problem === "too-deep"
        ? "The request is nested too deeply."
        : "The request has too many fields.";
  return res.status(400).json({ error, code: "unsafe_input" });
}

const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", API_CSP);
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader("Origin-Agent-Cluster", "?1");
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
  }
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  next();
}

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const MAX_TRACKED = 20000;
const failures = new Map();

function failureKey(email) {
  return String(email || "").toLowerCase().trim().slice(0, 254);
}

function recentFailures(key, now = Date.now()) {
  const list = (failures.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list;
}

function accountLocked(email, now = Date.now()) {
  const key = failureKey(email);
  if (!key) return null;
  const list = recentFailures(key, now);
  if (list.length < MAX_FAILURES) return null;
  return Math.max(1, Math.ceil((WINDOW_MS - (now - list[0])) / 1000));
}

function noteFailedLogin(email, now = Date.now()) {
  const key = failureKey(email);
  if (!key) return;
  if (failures.size >= MAX_TRACKED) {
    for (const k of failures.keys()) {
      recentFailures(k, now);
      if (failures.size < MAX_TRACKED) break;
    }
    if (failures.size >= MAX_TRACKED) failures.delete(failures.keys().next().value);
  }
  const list = recentFailures(key, now);
  list.push(now);
  failures.set(key, list);
}

function clearFailedLogins(email) {
  failures.delete(failureKey(email));
}

const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "password1234", "passw0rd", "p@ssw0rd",
  "12345678", "123456789", "1234567890", "12341234", "11111111", "00000000", "87654321",
  "qwertyui", "qwerty12", "qwerty123", "qwertyuiop", "1q2w3e4r", "1qaz2wsx", "zaq12wsx",
  "iloveyou", "sunshine", "princess", "football", "baseball", "welcome1", "welcome123",
  "abc12345", "abcd1234", "admin123", "letmein1", "trustno1", "dragon12", "monkey12",
  "superman", "starwars", "whatever", "computer", "internet", "michael1", "jennifer",
  "changeme", "ledgerwatch", "ledgerwatch1", "ledgerwatch123", "nigeria1", "nigeria123",
]);

function passwordProblem(password, { email, name } = {}) {
  if (typeof password !== "string") return "Password must be text.";
  if (password.length < 8) return "Password must be at least 8 characters";
  if (password.length > 256) return "Password must be 256 characters or fewer";
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return "That password is one of the most commonly used and is easy to guess. Choose another.";
  if (/^(.)\1+$/.test(password)) return "A password made of one repeated character is easy to guess. Choose another.";
  const local = String(email || "").toLowerCase().split("@")[0];
  if (local && local.length >= 4 && lower.includes(local)) return "Your password should not contain your email address.";
  const first = String(name || "").toLowerCase().trim().split(/\s+/)[0];
  if (first && first.length >= 4 && lower === first) return "Your password should not be your name.";
  return null;
}

function _resetForTests() {
  failures.clear();
}

module.exports = {
  parseQuery,
  rejectUnsafeInput,
  findProblem,
  securityHeaders,
  accountLocked,
  noteFailedLogin,
  clearFailedLogins,
  passwordProblem,
  MAX_FAILURES,
  _resetForTests,
};
