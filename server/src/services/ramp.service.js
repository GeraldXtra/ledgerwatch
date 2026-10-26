const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { describeError } = require("./rpc.service");

const TIMEOUT_MS = 15000;
const CRYPTOS = ["USDT", "USDC", "BTC", "ETH", "SOL", "TRX", "TON", "LTC", "DOGE", "BNB"];
const MODES = ["BUY", "SELL"];
const MAX_FIAT = 50000000;

const HOSTS = {
  production: { api: "https://api.transak.com", gateway: "https://api-gateway.transak.com" },
  staging: { api: "https://api-stg.transak.com", gateway: "https://api-gateway-stg.transak.com" },
};

function config() {
  const apiKey = String(process.env.TRANSAK_API_KEY || "").trim();
  const secret = String(process.env.TRANSAK_API_SECRET || "").trim();
  const env = String(process.env.TRANSAK_ENV || "production").trim().toLowerCase() === "staging" ? "staging" : "production";
  return { apiKey, secret, env, hosts: HOSTS[env], configured: Boolean(apiKey && secret) };
}

function webhookUrl() {
  const base = String(process.env.SERVER_URL || "").trim().replace(/\/+$/, "");
  return base ? `${base}/api/ramp/webhook` : null;
}

function rampStatus() {
  const c = config();
  return {
    configured: c.configured,
    provider: "transak",
    environment: c.env,
    fiat: "NGN",
    cryptos: CRYPTOS,
    referrerDomain: referrerDomain(),
    webhookUrl: webhookUrl(),
    reason: c.configured ? null : "Buying and selling with naira is not switched on yet on this server.",
  };
}

let token = null;
let previousToken = null;
let lastSessionProblem = null;

function upstreamMessage(res, json) {
  const fromBody =
    json &&
    ((json.error && typeof json.error === "object" && json.error.message) ||
      (typeof json.error === "string" && json.error) ||
      json.message);
  const denyReason = res.headers && typeof res.headers.get === "function" ? res.headers.get("x-deny-reason") : null;
  const said = String(fromBody || denyReason || `HTTP ${res.status}`).slice(0, 200);
  return { said, status: res.status };
}

async function post(url, headers, body) {
  let res;
  let json;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    json = await res.json().catch(() => null);
  } catch (err) {
    const { code } = describeError(err);
    return { ok: false, kind: "unreachable", reason: `The payment provider could not be reached (${code || "error"}).` };
  }
  if (!res.ok || !json) {
    const { said, status } = upstreamMessage(res, json);
    return {
      ok: false,
      kind: status >= 500 ? "upstream" : "rejected",
      status,
      said,
      reason: `The payment provider refused the request: ${said}`,
    };
  }
  return { ok: true, value: json };
}

const KEY_REFUSALS = /api[_ -]?key|unauthori[sz]ed|forbidden/i;

function explainSessionRefusal(r, c) {
  const code = String(r.said || "");
  if ((r.status === 401 || r.status === 403) && (KEY_REFUSALS.test(code) || code === `HTTP ${r.status}`)) {
    const which = c.env === "staging" ? "staging" : "production";
    return (
      `Transak refused to open a ${which} payment page for this server (${code}). Its ${which} gateway accepts a partner's ` +
      `requests only from the backend IP addresses listed on the partner's security form in the Transak dashboard, and only ` +
      `with the domain ${referrerDomain() || "named in CLIENT_URL"} whitelisted there. The API keys themselves were accepted, ` +
      `so this is the dashboard side: add this server's outbound IP addresses and the domain, or ask Transak support to.`
    );
  }
  return r.reason;
}

async function accessToken() {
  const c = config();
  if (!c.configured) return { ok: false, kind: "invalid", reason: rampStatus().reason };
  if (token && token.expiresAt - Date.now() > 60 * 60 * 1000) return { ok: true, token: token.value };
  const r = await post(`${c.hosts.api}/partners/api/v2/refresh-token`, { "x-api-key": c.apiKey, "api-secret": c.secret }, { apiKey: c.apiKey });
  if (!r.ok) return r;
  const data = r.value.data || r.value;
  if (!data || typeof data.accessToken !== "string") return { ok: false, kind: "upstream", reason: "The payment provider did not return an access token." };
  const expires = Number(data.expiresAt);
  if (token && token.value !== data.accessToken) previousToken = token.value;
  token = { value: data.accessToken, expiresAt: expires > 1e12 ? expires : expires * 1000 };
  return { ok: true, token: token.value };
}

function referrerDomain() {
  const first = String(process.env.CLIENT_URL || "").split(",")[0].trim();
  try {
    return new URL(first).host;
  } catch {
    return null;
  }
}

function newOrderRef() {
  return `lw_${crypto.randomBytes(12).toString("hex")}`;
}

async function createSession({ user, mode, cryptoCurrencyCode, fiatAmount }) {
  const c = config();
  if (!c.configured) return { ok: false, kind: "invalid", reason: rampStatus().reason };
  if (!MODES.includes(mode)) return { ok: false, kind: "invalid", reason: 'Choose either "BUY" or "SELL".' };
  if (cryptoCurrencyCode != null && !CRYPTOS.includes(cryptoCurrencyCode)) return { ok: false, kind: "invalid", reason: "That coin is not offered here." };
  let amount = null;
  if (fiatAmount != null && fiatAmount !== "") {
    amount = Number(fiatAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_FIAT) return { ok: false, kind: "invalid", reason: "Enter a naira amount above zero." };
    amount = Math.round(amount);
  }
  const domain = referrerDomain();
  if (!domain) return { ok: false, kind: "invalid", reason: "CLIENT_URL is not set on the server, so the payment page cannot be opened." };

  const t = await accessToken();
  if (!t.ok) return t;

  const partnerOrderId = newOrderRef();
  const widgetParams = {
    apiKey: c.apiKey,
    referrerDomain: domain,
    productsAvailed: mode,
    fiatCurrency: "NGN",
    partnerOrderId,
    partnerCustomerId: String(user._id),
  };
  if (cryptoCurrencyCode) widgetParams.cryptoCurrencyCode = cryptoCurrencyCode;
  if (amount && mode === "BUY") widgetParams.fiatAmount = amount;
  if (user.email && user.emailVerified) widgetParams.email = user.email;

  const session = (accessTokenValue) =>
    post(`${c.hosts.gateway}/api/v2/auth/session`, { "access-token": accessTokenValue, "x-api-key": c.apiKey }, { widgetParams });

  let r = await session(t.token);
  if (!r.ok && r.status === 401) {
    token = token ? { ...token, expiresAt: 0 } : null;
    const fresh = await accessToken();
    if (fresh.ok && fresh.token !== t.token) r = await session(fresh.token);
  }
  if (!r.ok) {
    const reason = explainSessionRefusal(r, c);
    lastSessionProblem = { at: new Date().toISOString(), status: r.status || null, said: r.said || null, reason };
    console.error(`[ramp] ${reason}`);
    return { ...r, reason };
  }
  lastSessionProblem = null;
  const widgetUrl = r.value.data && r.value.data.widgetUrl;
  let parsed;
  try {
    parsed = new URL(String(widgetUrl || ""));
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.protocol !== "https:" || !/(^|\.)transak\.com$/.test(parsed.hostname)) {
    return { ok: false, kind: "upstream", reason: "The payment provider returned a page address that could not be trusted." };
  }
  return { ok: true, widgetUrl: parsed.href, partnerOrderId, mode, cryptoCurrencyCode: cryptoCurrencyCode || null, fiatAmount: amount };
}

function verifyWebhook(data) {
  if (typeof data !== "string" || data.split(".").length !== 3) return null;
  for (const secret of [token && token.value, previousToken].filter(Boolean)) {
    try {
      return jwt.verify(data, secret, { algorithms: ["HS256", "HS384", "HS512"] });
    } catch {
      continue;
    }
  }
  return null;
}

let lastForcedRefresh = 0;
const FORCED_REFRESH_GAP_MS = 10 * 60 * 1000;

async function verifyWebhookFresh(data) {
  const first = verifyWebhook(data);
  if (first) return first;
  if (!config().configured || Date.now() - lastForcedRefresh < FORCED_REFRESH_GAP_MS) return null;
  lastForcedRefresh = Date.now();
  token = token ? { ...token, expiresAt: 0 } : null;
  const t = await accessToken();
  return t.ok ? verifyWebhook(data) : null;
}

const DONE = new Set(["COMPLETED"]);
const FAILED = new Set(["FAILED", "EXPIRED", "CANCELLED", "REFUNDED"]);

function outcomeOf(status) {
  const s = String(status || "").toUpperCase();
  if (DONE.has(s)) return "completed";
  if (s === "ON_HOLD_PENDING_DELIVERY_FROM_TRANSAK") return "on-hold";
  if (FAILED.has(s)) return "failed";
  return "in-progress";
}

async function rampStatusChecked() {
  const base = rampStatus();
  if (!base.configured) return base;
  const t = await accessToken();
  const keysAccepted = t.ok;
  const problem = !t.ok
    ? `Transak did not accept the keys on this server for its ${base.environment} environment (${t.said || t.reason}). ` +
      (base.environment === "production"
        ? "Staging keys need TRANSAK_ENV=staging; otherwise paste the production keys from the Transak dashboard."
        : "Production keys need TRANSAK_ENV unset or production.")
    : lastSessionProblem
      ? lastSessionProblem.reason
      : null;
  return { ...base, keysAccepted, problem, lastSessionProblem };
}

function logStartup() {
  const s = rampStatus();
  if (!s.configured) {
    console.log("[ramp] Naira buy and sell is off: TRANSAK_API_KEY and TRANSAK_API_SECRET are not set.");
    return;
  }
  console.log(
    `[ramp] Transak ${s.environment}: referrer domain ${s.referrerDomain || "(CLIENT_URL not set)"}, ` +
      `webhook ${s.webhookUrl || "(SERVER_URL not set)"}. Both must be registered with Transak, with this server's outbound IP addresses.`
  );
}

function _resetForTests() {
  lastForcedRefresh = 0;
  token = null;
  previousToken = null;
  lastSessionProblem = null;
}

module.exports = {
  CRYPTOS,
  rampStatus,
  rampStatusChecked,
  logStartup,
  accessToken,
  createSession,
  verifyWebhook,
  verifyWebhookFresh,
  outcomeOf,
  _resetForTests,
};
