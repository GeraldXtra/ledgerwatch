const crypto = require("crypto");
const axios = require("axios");

/**
 * Sign in with Google, by REDIRECT and not by a script in the page.
 *
 * WHY NOT THE GOOGLE IDENTITY SERVICES BUTTON. That approach loads a script from
 * accounts.google.com into the page, and this application decrypts private keys
 * in that same page. docs/SECURITY.md forbids a third party runtime script in
 * the client for exactly that reason. The authorization code flow needs no
 * script at all: the browser is sent to Google, Google sends it back to THIS
 * server with a one time code, and this server, holding the client secret,
 * exchanges the code for the person's verified profile. Nothing from Google
 * ever executes in the wallet's origin.
 *
 * The profile comes from Google's userinfo endpoint using the access token the
 * exchange returned, which is authoritative: only a token minted by Google for
 * this client can read it. That is why the id token is not decoded or verified
 * here. Doing so correctly means fetching and caching Google's signing keys,
 * and it would prove nothing the userinfo call has not already proved.
 *
 * Needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and SERVER_URL. Absent any of
 * them the button on the sign in page explains itself and nothing else changes,
 * in keeping with the rule that every integration degrades gracefully.
 */

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

/** The public base URL of this API, no trailing slash. */
function serverBase() {
  return String(process.env.SERVER_URL || "")
    .trim()
    .replace(/\/+$/, "");
}

/** The first configured client origin, no trailing slash. */
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

/**
 * A STATELESS signed state parameter.
 *
 * OAuth's `state` exists to stop a forged callback logging somebody into an
 * attacker's account. The usual implementation stores a nonce in a session
 * cookie; this server has no session store and no cookies, so the state is
 * instead an HMAC over a timestamp and a nonce, keyed by JWT_SECRET. It proves
 * the callback began at this server, within the last few minutes, without
 * anything being kept anywhere.
 */
function sign(payload) {
  return crypto
    .createHmac("sha256", String(process.env.JWT_SECRET || ""))
    .update(payload)
    .digest("hex");
}

/**
 * THE BROWSER NONCE, and the attack it closes.
 *
 * The callback lands the session token in the URL fragment of the sign in
 * page. Anyone could therefore build `/login#token=<their own token>` and send
 * it to somebody: the recipient's browser would store the attacker's session
 * and every invoice, debtor and wallet address they then entered would land
 * in the attacker's account. That is a login CSRF, and the HMAC on `state`
 * alone does not stop it, because the forged link never passes through Google
 * at all.
 *
 * So the browser that STARTS the flow mints a random nonce, keeps it in its own
 * session storage, and sends it here. It is folded into the signed state,
 * returned to the browser beside the token, and the sign in page refuses a
 * token whose nonce is not the one it minted. A forged link cannot carry a
 * nonce the victim's browser holds.
 */
const NONCE_RE = /^[A-Za-z0-9_-]{8,64}$/;

function makeState(clientNonce) {
  const n = NONCE_RE.test(String(clientNonce || "")) ? String(clientNonce) : "";
  const payload = `${Date.now()}.${crypto.randomBytes(12).toString("hex")}.${n}`;
  return `${payload}.${sign(payload)}`;
}

/** @returns {{ok:boolean, nonce:string}} */
function verifyState(state) {
  const raw = String(state || "");
  const at = raw.lastIndexOf(".");
  if (at <= 0) return { ok: false, nonce: "" };
  const payload = raw.slice(0, at);
  const given = raw.slice(at + 1);
  const expected = sign(payload);
  if (given.length !== expected.length) return { ok: false, nonce: "" };
  // Constant time, so the comparison itself cannot be used to recover the MAC.
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
    // Always show the account chooser. Silently reusing whichever Google account
    // is signed into the browser is how a shared computer signs into the wrong
    // ledger.
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
  return data; // { access_token, id_token, expires_in, ... }
}

/** @returns {Promise<{sub:string,email:string,email_verified:boolean,name:string,picture:string}>} */
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
