const DEFAULT_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS || 12000);

const MAX_CONCURRENT = Number(process.env.RPC_MAX_CONCURRENT || 6);

let active = 0;
const waiting = [];

function acquire() {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) next();
  else active--;
}

function endpointHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

function describeError(err) {
  if (err && err.name === "TimeoutError") return { code: "ETIMEDOUT", detail: "no response within the timeout" };
  if (err && err.name === "AbortError") return { code: "ABORTED", detail: "request aborted" };

  let cur = err && err.cause;
  let depth = 0;
  while (cur && depth < 4) {
    if (cur.code) return { code: cur.code, detail: cur.message || "" };
    cur = cur.cause;
    depth++;
  }
  return { code: "UNKNOWN", detail: (err && err.message) || "" };
}

const PRE_ACCEPT_CODES = new Set([
  "ENOTFOUND",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
]);
const PRE_ACCEPT_STATUS = new Set([401, 403, 404, 405, 429]);

function shouldFallThrough({ method, status, code }) {
  const preAccept = (code && PRE_ACCEPT_CODES.has(code)) || (status && PRE_ACCEPT_STATUS.has(status));
  if (preAccept) return true;
  if (method === "eth_sendRawTransaction") return false;
  return true;
}

function methodsOf(body) {
  const items = Array.isArray(body) ? body : [body];
  return items.map((i) => (i && i.method) || "");
}

async function postOnce(url, body, timeoutMs) {
  await acquire();
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, ms: Date.now() - startedAt };
  } catch (err) {
    const { code, detail } = describeError(err);
    return { ok: false, status: 0, code, detail, ms: Date.now() - startedAt };
  } finally {
    release();
  }
}

const DEGRADED_WARN_EVERY_MS = 10 * 60 * 1000;
const degradedWarnedAt = new Map();

function shouldWarnDegraded(chainId) {
  const now = Date.now();
  const last = degradedWarnedAt.get(chainId) || 0;
  if (now - last < DEGRADED_WARN_EVERY_MS) return false;
  degradedWarnedAt.set(chainId, now);
  return true;
}

async function sendToChain(chain, body, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const endpoints = chain.rpcs && chain.rpcs.length ? chain.rpcs : [chain.rpc];
  const methods = methodsOf(body);
  const isBroadcast = methods.includes("eth_sendRawTransaction");
  const attempts = [];
  let ambiguous = false;

  for (let i = 0; i < endpoints.length; i++) {
    const url = endpoints[i];
    const host = endpointHost(url);
    const r = await postOnce(url, body, timeoutMs);

    if (r.ok) {
      if (i > 0 && shouldWarnDegraded(chain.chainId)) {
        console.warn(
          `[rpc] ${chain.name}: endpoint ${i + 1}/${endpoints.length} (${host}) served ` +
            `${methods.join(",")} after ${i} failure(s) — primary is degraded. ` +
            `Further fallthroughs on this chain are not logged for ten minutes.`
        );
      }
      return {
        ok: true,
        status: r.status,
        text: r.text,
        host,
        attempt: i + 1,
        total: endpoints.length,
        attempts,
        ambiguous: false,
      };
    }

    const reason = r.code ? `${r.code}${r.detail ? ` (${r.detail})` : ""}` : `HTTP ${r.status}`;
    attempts.push({ host, status: r.status, code: r.code || null, reason, ms: r.ms, body: r.text ? r.text.slice(0, 200) : null });

    const fallThrough = shouldFallThrough({
      method: isBroadcast ? "eth_sendRawTransaction" : methods[0],
      status: r.status,
      code: r.code,
    });

    if (!fallThrough) {
      console.error(
        `[rpc] ${chain.name}: ${host} failed a BROADCAST ambiguously (${reason}). ` +
          `Not retrying elsewhere — the transaction may already be in the mempool.`
      );
      ambiguous = true;
      break;
    }
  }

  return {
    ok: false,
    status: 0,
    text: null,
    host: null,
    attempt: endpoints.length,
    total: endpoints.length,
    attempts,
    ambiguous,
  };
}

async function rpcCall(chain, method, params, opts = {}) {
  const res = await sendToChain(chain, { jsonrpc: "2.0", id: 1, method, params }, opts);

  if (!res.ok) {
    const summary = res.attempts.map((a) => `${a.host}: ${a.reason}`).join(" | ");
    console.error(`[rpc] ${method} on ${chain.name} failed on all ${res.total} endpoint(s) — ${summary}`);
    return null;
  }

  try {
    const json = JSON.parse(res.text);
    if (json.error) {
      console.error(`[rpc] ${method} on ${chain.name} returned an error: ${json.error.message}`);
      return null;
    }
    return json.result;
  } catch {
    console.error(`[rpc] ${method} on ${chain.name}: ${res.host} returned unparseable JSON`);
    return null;
  }
}

async function rpcCallTyped(chain, method, params, opts = {}) {
  const res = await sendToChain(chain, { jsonrpc: "2.0", id: 1, method, params }, opts);
  if (!res.ok) {
    const summary = res.attempts.map((a) => `${a.host}: ${a.reason}`).join(" | ");
    return { ok: false, reason: `all ${res.total} endpoint(s) failed: ${summary}` };
  }
  try {
    const json = JSON.parse(res.text);
    if (json.error) return { ok: false, reason: `rpc error: ${json.error.message}` };
    return { ok: true, result: json.result === undefined ? null : json.result };
  } catch {
    return { ok: false, reason: `${res.host} returned unparseable JSON` };
  }
}

module.exports = {
  sendToChain,
  rpcCall,
  rpcCallTyped,
  endpointHost,
  describeError,
  DEFAULT_TIMEOUT_MS,
};
