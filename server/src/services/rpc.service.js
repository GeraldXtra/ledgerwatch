/**
 * THE ONE PLACE THE SERVER TALKS TO A CHAIN.
 *
 * The wallet proxy, the payment watcher and the inbound-history sync each had
 * their own bare `fetch(chain.rpc, ...)`. Three copies meant three timeouts to
 * add (there were none), three fallbacks to write, and three different error
 * messages for the same failure. This is the single implementation they share.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * The wallet balance was failing with `wallet rpc proxy error: fetch failed`.
 * That message is not a diagnosis — undici sets `err.message` to exactly that
 * string for ANY transport failure and hides the real reason on `err.cause`,
 * which the old code discarded. Measured, the true causes were two:
 *
 *   1. Alchemy answered HTTP 403 "BASE_SEPOLIA is not enabled for this app" on
 *      every call. The key is valid; the networks are simply not switched on for
 *      that Alchemy app. Base Sepolia is the DEFAULT wallet chain, so the default
 *      chain had no working RPC — permanently, not intermittently. A 403 is a
 *      normal HTTP response and never throws, so it could not have produced
 *      "fetch failed" at all.
 *   2. A genuinely dead host (Polygon Amoy's documented endpoint) DOES produce
 *      that bare string, via a connect-level failure.
 *
 * Both are handled here: the cause is unwrapped and reported, and a failed
 * endpoint falls through to the next verified one for that chain.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS "TRY THE NEXT ENDPOINT"
 * ---------------------------------------------------------------------------
 * Only ENDPOINT-level failures. A JSON-RPC error inside a 200 response is the
 * chain's real answer — "execution reverted" means the same thing everywhere, so
 * retrying elsewhere would just cost a second round trip and return the same
 * error. Those are forwarded untouched.
 *
 * eth_sendRawTransaction is treated more carefully than reads: see SEND_SAFE.
 */

const DEFAULT_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS || 12000);

/**
 * Maximum upstream requests in flight at once, across all chains.
 *
 * Measured on this machine against the live endpoints: 8 concurrent connections
 * succeed comfortably, 12 fail COMPLETELY — Alchemy (40.160.x), Cloudflare
 * (104.18/172.64) and publicnode (172.66) all returning UND_ERR_CONNECT_TIMEOUT
 * at the same moment. Three unrelated providers failing at the TCP connect layer
 * simultaneously is not three providers rate-limiting; it is a local ceiling on
 * concurrent TLS connections. Past it, everything fails at once and every caller
 * pays the full timeout before finding out.
 *
 * 6 sits comfortably under the observed cliff. Queuing is strictly better than
 * failing here: a queued request is a little slower, a refused one is a blank
 * balance.
 */
const MAX_CONCURRENT = Number(process.env.RPC_MAX_CONCURRENT || 6);

let active = 0;
const waiting = [];

/** Resolves when a slot is free. Always paired with `release()` in a finally. */
function acquire() {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  // Hand the slot straight over rather than decrementing and re-incrementing,
  // so a burst cannot slip past the limit between the two operations.
  if (next) next();
  else active--;
}

/**
 * Host only. The full URL embeds the Alchemy key, so it must never reach a log
 * file, an HTTP response body or the browser.
 */
function endpointHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

/**
 * Unwrap what `fetch failed` is actually hiding. undici nests the real socket
 * error one or more levels down on `.cause`.
 *
 * @returns {{code:string, detail:string}}
 */
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

/**
 * Failures where the request provably never reached the node, or was refused
 * before any work was done. Safe to retry elsewhere for ANY method, including a
 * transaction broadcast, because nothing can have been accepted.
 */
const PRE_ACCEPT_CODES = new Set([
  "ENOTFOUND",      // DNS — the dead-host case
  "ECONNREFUSED",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
]);
const PRE_ACCEPT_STATUS = new Set([401, 403, 404, 405, 429]);

/**
 * SEND_SAFE.
 *
 * A timeout or a 5xx on eth_sendRawTransaction is AMBIGUOUS: the node may have
 * accepted the transaction and simply failed to tell us. Re-broadcasting the
 * identical signed payload elsewhere is harmless in itself — same bytes, same
 * hash, and a node that already has it says "already known" — but that reply
 * surfaces as an error, so a transaction that is genuinely in flight would be
 * reported to the user as failed. They would then send it again.
 *
 * So for broadcasts we fall through only on PRE_ACCEPT failures, where the node
 * demonstrably never got it. Everything else is reported honestly as unknown.
 * Reads have no such hazard and fall through on anything.
 */
function shouldFallThrough({ method, status, code }) {
  const preAccept = (code && PRE_ACCEPT_CODES.has(code)) || (status && PRE_ACCEPT_STATUS.has(status));
  if (preAccept) return true;
  if (method === "eth_sendRawTransaction") return false;
  // Reads: timeouts, resets and 5xx are all worth another endpoint.
  return true;
}

/** The method name(s) in a JSON-RPC body, for the fall-through decision. */
function methodsOf(body) {
  const items = Array.isArray(body) ? body : [body];
  return items.map((i) => (i && i.method) || "");
}

/**
 * POST a JSON-RPC body to ONE endpoint.
 * Resolves with a descriptive outcome instead of throwing, so the caller can
 * decide about fall-through without a try/catch per endpoint.
 */
async function postOnce(url, body, timeoutMs) {
  // Wait for a connection slot BEFORE starting the clock, so queuing time is not
  // charged against the request's timeout budget — otherwise a queued request
  // could "time out" having never been sent.
  await acquire();
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // There was NO timeout anywhere in the server before this. A hung upstream
      // held the Express request open until the browser gave up, and the balance
      // screen fans out several calls at once.
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

/**
 * Send a JSON-RPC body to a chain, walking its endpoint list until one answers.
 *
 * @returns {Promise<{ok:boolean, status:number, text:string, host:string,
 *                    attempt:number, total:number, attempts:Array}>}
 *          `ok:false` with every attempt recorded when the whole list is exhausted.
 */
const DEGRADED_WARN_EVERY_MS = 10 * 60 * 1000;
const degradedWarnedAt = new Map(); // chainId -> last warning time

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

  for (let i = 0; i < endpoints.length; i++) {
    const url = endpoints[i];
    const host = endpointHost(url);
    const r = await postOnce(url, body, timeoutMs);

    if (r.ok) {
      /**
       * Succeeded on something other than the preferred endpoint. Worth saying
       * out loud, since it means the primary is degraded and nobody would
       * otherwise notice until it failed completely.
       *
       * Said ONCE per chain per ten minutes, not once per call. On a chain
       * whose first endpoint refuses a method permanently, every single request
       * fell through and this line printed on all of them, filling the log
       * with thousands of identical warnings that buried anything real. The
       * first occurrence is the information; the rest is noise.
       */
      if (i > 0 && shouldWarnDegraded(chain.chainId)) {
        console.warn(
          `[rpc] ${chain.name}: endpoint ${i + 1}/${endpoints.length} (${host}) served ` +
            `${methods.join(",")} after ${i} failure(s) — primary is degraded. ` +
            `Further fallthroughs on this chain are not logged for ten minutes.`
        );
      }
      return { ok: true, status: r.status, text: r.text, host, attempt: i + 1, total: endpoints.length, attempts };
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
      break;
    }
  }

  return { ok: false, status: 0, text: null, host: null, attempt: endpoints.length, total: endpoints.length, attempts };
}

/**
 * Convenience wrapper for internal callers: one method, one result.
 * Returns null on failure (matching what the watchers already expected) but logs
 * the REAL reason for every endpoint tried rather than a bare "fetch failed".
 */
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
      // A real answer from the chain, not an endpoint fault. Logged at a lower
      // volume because callers routinely probe for things that do not exist.
      console.error(`[rpc] ${method} on ${chain.name} returned an error: ${json.error.message}`);
      return null;
    }
    return json.result;
  } catch {
    console.error(`[rpc] ${method} on ${chain.name}: ${res.host} returned unparseable JSON`);
    return null;
  }
}

module.exports = {
  sendToChain,
  rpcCall,
  endpointHost,
  describeError,
  DEFAULT_TIMEOUT_MS,
};
