const crypto = require("crypto");
const axios = require("axios");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const STATE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT = 10000;

function googleConfigured() {
  return Boolean(
    String(process.env.GOOGLE_CLIENT_ID || "").trim() &&
      String(process.env.GOOGLE_CLIENT_SECRET || "").trim()
  );
}

function serverBase() {
  return String(process.env.SERVER_URL || "")
    .trim()
    .replace(/\/+$/, "");
}

function clientBase() {
  const first = String(process.env.CLIENT_URL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)[0];
  return (first || "http://localhost:5173").replace(/\/+$/, "");
}

function redirectUri() {
  return `${serverBase()}/api/auth/google/callback`;
}

function sign(payload) {
  return crypto
    .createHmac("sha256", String(process.env.JWT_SECRET || ""))
    .update(payload)
    .digest("hex");
}

const NONCE_RE = /^[A-Za-z0-9_-]{8,64}$/;

function makeState(clientNonce) {
  const n = NONCE_RE.test(String(clientNonce || "")) ? String(clientNonce) : "";
  const payload = `${Date.now()}.${crypto.randomBytes(12).toString("hex")}.${n}`;
  return `${payload}.${sign(payload)}`;
}

function verifyState(state) {
  const raw = String(state || "");
  const at = raw.lastIndexOf(".");
  if (at <= 0) return { ok: false, nonce: "" };
  const payload = raw.slice(0, at);
  const given = raw.slice(at + 1);
  const expected = sign(payload);
  if (given.length !== expected.length) return { ok: false, nonce: "" };
  if (!crypto.timingSafeEqual(Buffer.from(given, "utf8"), Buffer.from(expected, "utf8"))) {
    return { ok: false, nonce: "" };
  }
  const parts = payload.split(".");
  const ts = Number(parts[0]);
  const nonce = NONCE_RE.test(parts[2] || "") ? parts[2] : "";
  return { ok: Number.isFinite(ts) && Date.now() - ts <= STATE_TTL_MS, nonce };
}

function authorizationUrl(clientNonce) {
  const params = new URLSearchParams({
    client_id: String(process.env.GOOGLE_CLIENT_ID).trim(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state: makeState(clientNonce),
    prompt: "select_account",
    access_type: "online",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    code,
    client_id: String(process.env.GOOGLE_CLIENT_ID).trim(),
    client_secret: String(process.env.GOOGLE_CLIENT_SECRET).trim(),
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
  const { data } = await axios.post(TOKEN_URL, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: TIMEOUT,
  });
  return data;
}

async function fetchProfile(accessToken) {
  const { data } = await axios.get(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: TIMEOUT,
  });
  return data;
}

module.exports = {
  googleConfigured,
  serverBase,
  clientBase,
  redirectUri,
  authorizationUrl,
  verifyState,
  exchangeCode,
  fetchProfile,
  NONCE_RE,
};
