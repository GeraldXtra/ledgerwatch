/**
 * THE ONE PLACE THE SERVER TALKS TO THE BITCOIN NETWORK.
 *
 * Bitcoin has no JSON-RPC equivalent of `rpc.service.js` here because LedgerWatch
 * runs no Bitcoin node. It reads the chain through Esplora, the block explorer
 * HTTP API that Blockstream publishes and mempool.space reimplements. This module
 * is the only path to it, for the same reason `rpc.service.js` is the only path to
 * an EVM chain: three copies of a `fetch` means three timeouts to add, three
 * fallbacks to write and three different error strings for one failure.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY FUNCTION RETURNS A TYPED OUTCOME AND NEVER THROWS OR RETURNS null
 * ---------------------------------------------------------------------------
 * `rpcCall` collapses four distinct conditions into a bare `null` (defect LW-006),
 * and one of its callers reads that null as proof that a confirmed transaction
 * vanished. Money moved on that mistake. So nothing here returns null and nothing
 * throws. Every function resolves to either
 *
 *     { ok: true,  ...data }
 *   or
 *     { ok: false, kind, reason }
 *
 * where `kind` says WHICH failure it was, so a caller can never confuse "the
 * endpoint was unreachable" with "the address holds nothing". This is
 * ARCHITECTURE.md invariant 16 and it is not optional.
 *
 * `kind` is one of:
 *   invalid       the input never left this process, we refused it
 *   unreachable   every endpoint failed at the transport layer
 *   upstream      an endpoint answered, with a status we cannot interpret
 *   rejected      the network gave a real, readable "no" (a mempool rejection)
 *   unparseable   HTTP 200, but the body was not the shape Esplora documents
 *   ambiguous     a broadcast may or may not have been accepted, see SEND_SAFE
 *
 * A FAILED BALANCE READ IS NEVER A ZERO. `getBalance` returns `{ok:false}` and
 * carries no numbers at all, so there is no field a caller could accidentally
 * render as 0. That is CLAUDE.md hard rule 4, enforced by the shape of the type
 * rather than by everybody remembering it.
 *
 * ---------------------------------------------------------------------------
 * ENDPOINT ORDER, AND WHY mempool.space IS SECOND
 * ---------------------------------------------------------------------------
 * Measured from the deployment machine: every Blockstream path used here answers
 * 200. mempool.space TIMES OUT entirely. It is therefore a fallback only and must
 * never be required for anything to work. If it ever becomes primary, or the only
 * endpoint for some call, that call is dead on this machine and nothing will say
 * so out loud.
 *
 * The two are Esplora compatible for address, utxo, tx and tip queries, and are
 * NOT compatible for fees: Blockstream serves `/fee-estimates` (a map of target
 * blocks to sat per vB) while mempool.space serves `/v1/fees/recommended` (named
 * tiers). Each endpoint therefore carries its own path and its own parser rather
 * than the code assuming one shape and quietly reading `undefined`.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE NEVER DOES
 * ---------------------------------------------------------------------------
 * It never sees a private key, a mnemonic or a password. Signing happens in the
 * browser (see client/src/features/wallet/bitcoin/tx.js) and the server learns
 * only a public address and an already signed transaction, which is public by
 * definition the moment it is broadcast. Nothing here logs a full URL either: the
 * path carries the user's address, and an address in a shared log file is a
 * privacy leak even though it is not a key.
 */

// Host extraction and the undici `.cause` unwrapping are exactly the same problem
// here as they are for EVM RPC, so they are reused rather than reimplemented. A
// second copy would drift, and the copy that drifted would be the one printing
// "fetch failed" with the real reason thrown away.
const { describeError, endpointHost } = require("./rpc.service");

const DEFAULT_TIMEOUT_MS = Number(process.env.BITCOIN_API_TIMEOUT_MS || 12000);

/**
 * Requests in flight at once against Esplora.
 *
 * `rpc.service.js` measured a hard local ceiling on concurrent TLS connections on
 * this machine: 8 succeed, 12 fail all at once with connect timeouts across three
 * unrelated providers. That ceiling is per machine, not per provider, so Bitcoin
 * calls and EVM calls genuinely share it.
 *
 * They do NOT share a limiter, because `rpc.service.js` does not export one and
 * this stream may not change that file. The two budgets are therefore additive in
 * the worst case (6 + 4 = 10), which sits under the observed cliff of 12 but not
 * by much. If a future change raises either number, raise it knowing that.
 */
const MAX_CONCURRENT = Number(process.env.BITCOIN_MAX_CONCURRENT || 4);

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
  // Hand the slot straight over rather than decrement then increment, so a burst
  // cannot slip past the limit in the gap between the two operations.
  if (next) next();
  else active--;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/**
 * Ordered per network. First entry is preferred; later entries are tried only
 * when an earlier one fails at the endpoint level.
 *
 * `flavour` selects the fee path and parser. Everything else is Esplora shaped on
 * both providers.
 */
const ENDPOINTS = {
  mainnet: [
    { base: "https://blockstream.info/api", flavour: "esplora" },
    { base: "https://mempool.space/api", flavour: "mempool" },
  ],
  testnet: [
    { base: "https://blockstream.info/testnet/api", flavour: "esplora" },
    { base: "https://mempool.space/testnet/api", flavour: "mempool" },
  ],
};

const NETWORKS = Object.keys(ENDPOINTS);

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/**
 * FORMAT validation only. This deliberately does NOT verify the bech32 checksum.
 *
 * Writing a bech32 checksum by hand on the server is exactly the kind of
 * from memory cryptography this project forbids, and the server is CommonJS while
 * the audited implementation (@scure/btc-signer) is ESM only, so it cannot simply
 * be required here. What this gate is for is refusing obvious rubbish before it
 * becomes an outbound HTTP request with attacker chosen path segments in it.
 *
 * The real checksum check happens in two places that can do it properly: the
 * browser, which decodes the destination with @scure/btc-signer before it will
 * build a transaction, and Esplora, which answers 400 "Invalid Bitcoin address"
 * and whose reason this module surfaces verbatim.
 *
 * Network matters as much as format. A testnet address on mainnet is not a typo
 * that bounces, it is a payment sent somewhere unspendable, so the prefixes are
 * checked per network and never accepted interchangeably.
 */
// bech32 and bech32m data charset is qpzry9x8gf2tvdw0s3jn54khce6mua7l:
// the letters b, i and o and the digit 1 are excluded on purpose, because they
// are the characters people misread.
const BECH32_BODY = "[02-9ac-hj-np-z]{11,87}";
// base58 excludes 0, O, I and l for the same reason.
const BASE58_BODY = "[1-9A-HJ-NP-Za-km-z]{25,39}";

const ADDRESS_RE = {
  // bc1 = mainnet segwit/taproot. 1 = P2PKH. 3 = P2SH.
  mainnet: new RegExp(`^(bc1${BECH32_BODY}|[13]${BASE58_BODY})$`),
  // tb1 = testnet segwit/taproot. m or n = P2PKH. 2 = P2SH.
  testnet: new RegExp(`^(tb1${BECH32_BODY}|[mn2]${BASE58_BODY})$`),
};

/** @returns {{ok:true, network:string}|{ok:false, kind:string, reason:string}} */
function validateNetwork(network) {
  if (typeof network !== "string" || !NETWORKS.includes(network)) {
    return {
      ok: false,
      kind: "invalid",
      reason: 'Network must be either "mainnet" or "testnet".',
    };
  }
  return { ok: true, network };
}

/** @returns {{ok:true, address:string}|{ok:false, kind:string, reason:string}} */
function validateAddress(address, network) {
  const net = validateNetwork(network);
  if (!net.ok) return net;

  if (typeof address !== "string" || address.length === 0) {
    return { ok: false, kind: "invalid", reason: "An address is required." };
  }
  // BIP 173 caps a bech32 address at 90 characters. Anything longer is not an
  // address, it is somebody probing the URL builder.
  if (address.length > 90) {
    return { ok: false, kind: "invalid", reason: "That address is too long to be a Bitcoin address." };
  }
  // Mixed case bech32 is invalid by specification, and lowercase is what every
  // wallet emits, so only lowercase is accepted for the bech32 forms. Base58
  // addresses are genuinely mixed case and are matched as such.
  const candidate = address.startsWith("BC1") || address.startsWith("TB1") ? address.toLowerCase() : address;

  if (!ADDRESS_RE[network].test(candidate)) {
    const expected = network === "mainnet" ? "bc1, 1 or 3" : "tb1, m, n or 2";
    return {
      ok: false,
      kind: "invalid",
      reason: `That is not a valid ${network} Bitcoin address. A ${network} address starts with ${expected}.`,
    };
  }
  return { ok: true, address: candidate };
}

/**
 * A serialised transaction, as lowercase hex.
 *
 * The size cap is the standardness limit: a node will not relay a transaction
 * over 100,000 bytes, so 200,000 hex characters is the largest thing that could
 * possibly succeed. Refusing above it locally is better than posting a payload
 * upstream that is guaranteed to bounce.
 */
const RAW_TX_MAX_HEX = 200000;

/** @returns {{ok:true, rawTx:string}|{ok:false, kind:string, reason:string}} */
function validateRawTx(rawTx) {
  if (typeof rawTx !== "string" || rawTx.length === 0) {
    return { ok: false, kind: "invalid", reason: "A signed transaction is required." };
  }
  const hex = rawTx.trim().toLowerCase();
  if (hex.length % 2 !== 0) {
    return { ok: false, kind: "invalid", reason: "That transaction hex has an odd number of characters, so it is incomplete." };
  }
  if (!/^[0-9a-f]+$/.test(hex)) {
    return { ok: false, kind: "invalid", reason: "That transaction is not valid hexadecimal." };
  }
  // Smallest conceivable serialised transaction is around 60 bytes. Well under
  // that is a truncated paste, not a transaction.
  if (hex.length < 40) {
    return { ok: false, kind: "invalid", reason: "That transaction is too short to be a real transaction." };
  }
  if (hex.length > RAW_TX_MAX_HEX) {
    return { ok: false, kind: "invalid", reason: "That transaction is larger than the network will relay." };
  }
  return { ok: true, rawTx: hex };
}

// ---------------------------------------------------------------------------
// The endpoint walk
// ---------------------------------------------------------------------------

/**
 * Statuses where the request provably never reached the indexer, or was refused
 * before any work was done. Safe to retry elsewhere for ANY call, broadcast
 * included, because nothing can have been accepted.
 */
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

/**
 * SEND_SAFE, the Bitcoin version.
 *
 * A timeout or a 5xx on POST /tx is AMBIGUOUS. The node may have accepted the
 * transaction and relayed it to the network before failing to answer us. Posting
 * the identical bytes to the second endpoint is harmless on the wire, since the
 * txid is the same and Bitcoin broadcast is idempotent, but the second indexer
 * replies with a 400 saying the transaction is already known. We would then tell
 * the user their payment failed while it was in fact confirming, and they would
 * send it a second time. That is a real double spend of the user's money, caused
 * entirely by our own error reporting.
 *
 * So a broadcast falls through only on PRE_ACCEPT failures. Everything else is
 * reported honestly as `kind: "ambiguous"`, which the UI must present as
 * "we do not know yet, check the address before sending again" and never as a
 * plain failure.
 *
 * Reads have no such hazard and fall through on anything.
 */
function shouldFallThrough({ isBroadcast, status, code }) {
  const preAccept = (code && PRE_ACCEPT_CODES.has(code)) || (status && PRE_ACCEPT_STATUS.has(status));
  if (preAccept) return true;
  if (isBroadcast) return false;
  return true;
}

/**
 * One HTTP call to one endpoint. Resolves with a description of what happened
 * rather than throwing, so the walk needs no try/catch per endpoint.
 */
async function fetchOnce(url, { method, body, timeoutMs }) {
  // Take a connection slot BEFORE starting the clock, so time spent queued is not
  // charged against the request's timeout budget. Otherwise a queued request can
  // report a timeout having never been sent, which is a lie the logs cannot undo.
  await acquire();
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "text/plain" } : undefined,
      body,
      // There was no timeout anywhere in the server before rpc.service.js added
      // one, and mempool.space hangs from this machine rather than refusing, so
      // without this the Express request stays open until the browser gives up.
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
 * Walk a network's endpoints until one answers, then hand the body to `parse`.
 *
 * @param {string} network             mainnet | testnet, already validated
 * @param {object} spec
 * @param {(ep:object)=>string} spec.path      path for THIS endpoint, so the two
 *                                             fee shapes can differ per provider
 * @param {(text:string, ep:object)=>object} spec.parse
 *        returns {ok:true, ...} or {ok:false, kind, reason}. Called only on 2xx.
 * @param {string} [spec.method]       default GET
 * @param {string} [spec.body]
 * @param {boolean} [spec.isBroadcast] applies SEND_SAFE
 * @param {string} spec.label          short name for logs, never a URL
 * @returns {Promise<object>} a typed outcome
 */
async function callAcross(network, spec) {
  const endpoints = ENDPOINTS[network];
  const timeoutMs = spec.timeoutMs || DEFAULT_TIMEOUT_MS;
  const attempts = [];

  for (let i = 0; i < endpoints.length; i++) {
    const ep = endpoints[i];
    const url = `${ep.base}${spec.path(ep)}`;
    const host = endpointHost(url);

    const r = await fetchOnce(url, { method: spec.method || "GET", body: spec.body, timeoutMs });

    if (r.ok) {
      if (i > 0) {
        // Succeeded on a fallback. Worth saying out loud: it means the primary is
        // degraded, and nobody would otherwise notice until the last endpoint
        // failed too and the feature went dark all at once.
        console.warn(
          `[btc] ${network}: endpoint ${i + 1}/${endpoints.length} (${host}) served ${spec.label} ` +
            `after ${i} failure(s) — the preferred endpoint is degraded`
        );
      }
      const parsed = spec.parse(r.text, ep);
      if (!parsed.ok) {
        console.error(`[btc] ${network}: ${host} answered ${spec.label} with a body we cannot read — ${parsed.reason}`);
      }
      return parsed;
    }

    /**
     * A 400 is a REAL ANSWER, not an endpoint fault.
     *
     * Esplora returns 400 with a readable sentence for both "that is not a valid
     * address" and "the mempool rejected this transaction because ...". Trying
     * the next endpoint would cost a round trip and get the identical answer,
     * exactly as a JSON-RPC error inside a 200 does on the EVM side. So it stops
     * here and the upstream reason is surfaced verbatim, because the reason is
     * the whole value: "bad-txns-inputs-missingorspent" tells the user something
     * "broadcast failed" never could.
     */
    if (r.status === 400) {
      const reason = (r.text || "").trim().slice(0, 300) || "The network rejected that request and gave no reason.";
      return { ok: false, kind: spec.isBroadcast ? "rejected" : "invalid", reason, host };
    }

    const reason = r.code ? `${r.code}${r.detail ? ` (${r.detail})` : ""}` : `HTTP ${r.status}`;
    attempts.push({ host, status: r.status, code: r.code || null, reason, ms: r.ms });

    if (!shouldFallThrough({ isBroadcast: spec.isBroadcast, status: r.status, code: r.code })) {
      console.error(
        `[btc] ${network}: ${host} failed a BROADCAST ambiguously (${reason}). Not retrying elsewhere — ` +
          `the transaction may already be in the mempool.`
      );
      return {
        ok: false,
        kind: "ambiguous",
        reason:
          "The network did not confirm whether it accepted this transaction. It may still go through. " +
          "Check the sending address before you try again, so you do not pay twice.",
        attempts,
      };
    }
  }

  const summary = attempts.map((a) => `${a.host}: ${a.reason}`).join(" | ");
  console.error(`[btc] ${network}: ${spec.label} failed on all ${endpoints.length} endpoint(s) — ${summary}`);

  // Distinguish "nothing answered at all" from "something answered badly", so a
  // caller can tell a dead network from a broken provider.
  const anyAnswered = attempts.some((a) => a.status > 0);
  return {
    ok: false,
    kind: anyAnswered ? "upstream" : "unreachable",
    reason: attempts.length
      ? `No Bitcoin ${network} endpoint could answer. Last reason: ${attempts[attempts.length - 1].reason}.`
      : `No Bitcoin ${network} endpoint is configured.`,
    attempts,
  };
}

/** JSON.parse that yields a typed failure instead of throwing. */
function parseJson(text, label) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, kind: "unparseable", reason: `The ${label} response was not valid JSON.` };
  }
}

/**
 * Satoshis are safe as JavaScript numbers, unlike EVM token amounts.
 *
 * The entire Bitcoin supply is 2.1e15 satoshis and Number.MAX_SAFE_INTEGER is
 * 9.007e15, so no real balance can lose precision. This is stated explicitly
 * because the EVM side of this codebase stores amounts as strings for exactly the
 * opposite reason (18 decimal amounts DO exceed IEEE 754), and copying that habit
 * here without understanding it would just make the arithmetic harder.
 */
function toSats(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Confirmed and pending balance for one address, in satoshis.
 *
 * NEVER returns a zero on failure. On any failure the outcome carries no numeric
 * field at all, so there is nothing a caller could render as a balance. A caller
 * that cannot read a balance must say "unavailable" (CLAUDE.md hard rule 4).
 *
 * @returns {Promise<{ok:true, address:string, network:string, confirmed:number,
 *                    pending:number, total:number, txCount:number}
 *                 | {ok:false, kind:string, reason:string}>}
 */
async function getBalance(address, network) {
  const a = validateAddress(address, network);
  if (!a.ok) return a;

  return callAcross(network, {
    label: "balance",
    path: () => `/address/${encodeURIComponent(a.address)}`,
    parse(text) {
      const p = parseJson(text, "balance");
      if (!p.ok) return p;
      const body = p.value;
      const chain = body && body.chain_stats;
      const pool = body && body.mempool_stats;
      // Guard the shape rather than reading undefined and arriving at NaN, which
      // would render as a blank balance with no explanation anywhere.
      if (!chain || typeof chain.funded_txo_sum === "undefined") {
        return { ok: false, kind: "unparseable", reason: "The balance response did not contain chain statistics." };
      }
      const confirmed = toSats(chain.funded_txo_sum) - toSats(chain.spent_txo_sum);
      const pending = pool ? toSats(pool.funded_txo_sum) - toSats(pool.spent_txo_sum) : 0;
      return {
        ok: true,
        address: a.address,
        network,
        confirmed,
        // Signed on purpose: an outgoing unconfirmed spend makes this negative,
        // and hiding that would show a balance the user cannot actually spend.
        pending,
        total: confirmed + pending,
        txCount: toSats(chain.tx_count) + (pool ? toSats(pool.tx_count) : 0),
      };
    },
  });
}

/**
 * Spendable outputs for one address.
 *
 * Returned unfiltered, including unconfirmed ones, with `confirmed` on each so
 * the caller decides its own policy. Silently dropping unconfirmed UTXOs here
 * would make a wallet that has just received money look empty, and the user would
 * have no way to find out why.
 *
 * @returns {Promise<{ok:true, address:string, network:string, utxos:Array,
 *                    total:number} | {ok:false, kind:string, reason:string}>}
 */
async function getUtxos(address, network) {
  const a = validateAddress(address, network);
  if (!a.ok) return a;

  return callAcross(network, {
    label: "utxos",
    path: () => `/address/${encodeURIComponent(a.address)}/utxo`,
    parse(text) {
      const p = parseJson(text, "utxo");
      if (!p.ok) return p;
      if (!Array.isArray(p.value)) {
        return { ok: false, kind: "unparseable", reason: "The utxo response was not a list." };
      }
      const utxos = p.value.map((u) => ({
        txid: String(u.txid || ""),
        vout: Number(u.vout || 0),
        value: toSats(u.value),
        confirmed: Boolean(u.status && u.status.confirmed),
        blockHeight: u.status && u.status.block_height != null ? Number(u.status.block_height) : null,
      }));
      return {
        ok: true,
        address: a.address,
        network,
        utxos,
        total: utxos.reduce((sum, u) => sum + u.value, 0),
      };
    },
  });
}

/**
 * Fee rates in satoshis per virtual byte.
 *
 * The two providers publish different shapes, so each carries its own path and
 * parser. Reading one shape and hoping is how you end up multiplying a vsize by
 * `undefined` and broadcasting a transaction with a zero fee that no node relays,
 * which looks exactly like a network outage from the user's chair.
 *
 * Every rate is floored at 1 sat/vB, the default minimum relay fee. A rate below
 * it produces a transaction that is valid, signed, and which no node will accept
 * or ever tell you it rejected.
 *
 * @returns {Promise<{ok:true, network:string, source:string, fast:number,
 *                    medium:number, slow:number, byTarget:object}
 *                 | {ok:false, kind:string, reason:string}>}
 */
const MIN_RELAY_SAT_PER_VB = 1;

async function getFeeRates(network) {
  const net = validateNetwork(network);
  if (!net.ok) return net;

  const floor = (v) => Math.max(MIN_RELAY_SAT_PER_VB, Math.ceil(Number(v) || 0));

  return callAcross(network, {
    label: "fees",
    path: (ep) => (ep.flavour === "mempool" ? "/v1/fees/recommended" : "/fee-estimates"),
    parse(text, ep) {
      const p = parseJson(text, "fee");
      if (!p.ok) return p;
      const body = p.value;

      if (ep.flavour === "mempool") {
        // { fastestFee, halfHourFee, hourFee, economyFee, minimumFee }
        if (!body || typeof body.fastestFee === "undefined") {
          return { ok: false, kind: "unparseable", reason: "The fee response did not contain recommended rates." };
        }
        return {
          ok: true,
          network,
          source: "mempool",
          fast: floor(body.fastestFee),
          medium: floor(body.halfHourFee),
          slow: floor(body.hourFee),
          byTarget: {
            1: floor(body.fastestFee),
            3: floor(body.halfHourFee),
            6: floor(body.hourFee),
            144: floor(body.economyFee),
          },
        };
      }

      // Esplora: { "1": 20.1, "2": 18.0, "3": ..., "6": ..., "144": ..., ... }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return { ok: false, kind: "unparseable", reason: "The fee response was not a map of block targets." };
      }
      const targets = Object.keys(body)
        .map(Number)
        .filter((t) => Number.isFinite(t))
        .sort((x, y) => x - y);
      if (targets.length === 0) {
        return { ok: false, kind: "unparseable", reason: "The fee response contained no block targets." };
      }
      // Nearest available target at or after the one we want, falling back to the
      // slowest published. Blockstream does not guarantee which targets appear.
      const at = (want) => {
        const hit = targets.find((t) => t >= want);
        return floor(body[String(hit != null ? hit : targets[targets.length - 1])]);
      };
      const byTarget = {};
      for (const t of targets) byTarget[t] = floor(body[String(t)]);
      return {
        ok: true,
        network,
        source: "esplora",
        fast: at(1),
        medium: at(6),
        slow: at(144),
        byTarget,
      };
    },
  });
}

/**
 * Broadcast an already signed transaction.
 *
 * The body is raw hex as text/plain, which is what Esplora's POST /tx expects. A
 * 200 carries the txid as bare text; a 400 carries the mempool's own rejection
 * reason, which is surfaced word for word because "bad-txns-inputs-missingorspent"
 * tells the user their UTXOs were already spent and "broadcast failed" does not.
 *
 * See SEND_SAFE above for why a timeout here is reported as `ambiguous` rather
 * than retried on the second endpoint.
 *
 * @returns {Promise<{ok:true, txid:string, network:string}
 *                 | {ok:false, kind:string, reason:string}>}
 */
async function broadcast(rawHexTx, network) {
  const net = validateNetwork(network);
  if (!net.ok) return net;
  const t = validateRawTx(rawHexTx);
  if (!t.ok) return t;

  return callAcross(network, {
    label: "broadcast",
    method: "POST",
    body: t.rawTx,
    isBroadcast: true,
    path: () => "/tx",
    parse(text) {
      const txid = (text || "").trim();
      // A txid is 32 bytes of hex and nothing else. Accepting anything else here
      // would hand the UI a "success" it could not link to a block explorer.
      if (!/^[0-9a-f]{64}$/.test(txid)) {
        return {
          ok: false,
          kind: "unparseable",
          reason: "The network accepted the transaction but did not return a usable transaction id.",
        };
      }
      return { ok: true, txid, network };
    },
  });
}

/**
 * Recent transactions touching one address, newest first.
 *
 * Esplora returns the raw inputs and outputs. The net movement for THIS address
 * is computed here rather than in the browser, because it is the same arithmetic
 * every caller needs and getting it wrong shows a spend as a receipt.
 *
 * @returns {Promise<{ok:true, address:string, network:string, txs:Array}
 *                 | {ok:false, kind:string, reason:string}>}
 */
async function getTxs(address, network) {
  const a = validateAddress(address, network);
  if (!a.ok) return a;

  return callAcross(network, {
    label: "txs",
    path: () => `/address/${encodeURIComponent(a.address)}/txs`,
    parse(text) {
      const p = parseJson(text, "transaction");
      if (!p.ok) return p;
      if (!Array.isArray(p.value)) {
        return { ok: false, kind: "unparseable", reason: "The transaction response was not a list." };
      }
      const txs = p.value.map((tx) => {
        const outs = Array.isArray(tx.vout) ? tx.vout : [];
        const ins = Array.isArray(tx.vin) ? tx.vin : [];
        const received = outs
          .filter((o) => o && o.scriptpubkey_address === a.address)
          .reduce((sum, o) => sum + toSats(o.value), 0);
        const sent = ins
          .filter((i) => i && i.prevout && i.prevout.scriptpubkey_address === a.address)
          .reduce((sum, i) => sum + toSats(i.prevout.value), 0);
        const delta = received - sent;
        return {
          txid: String(tx.txid || ""),
          confirmed: Boolean(tx.status && tx.status.confirmed),
          blockHeight: tx.status && tx.status.block_height != null ? Number(tx.status.block_height) : null,
          blockTime: tx.status && tx.status.block_time != null ? Number(tx.status.block_time) : null,
          fee: toSats(tx.fee),
          // Signed net movement for this address. A self spend nets to minus the
          // fee, which is the honest answer.
          valueDelta: delta,
          direction: delta >= 0 ? "in" : "out",
        };
      });
      return { ok: true, address: a.address, network, txs };
    },
  });
}

/**
 * Current best block height. Used to turn a UTXO's block height into a
 * confirmation count without a second round trip per output.
 *
 * @returns {Promise<{ok:true, network:string, height:number}
 *                 | {ok:false, kind:string, reason:string}>}
 */
async function getTipHeight(network) {
  const net = validateNetwork(network);
  if (!net.ok) return net;

  return callAcross(network, {
    label: "tip height",
    path: () => "/blocks/tip/height",
    parse(text) {
      // Plain integer as text, not JSON. Measured.
      const height = Number((text || "").trim());
      if (!Number.isInteger(height) || height <= 0) {
        return { ok: false, kind: "unparseable", reason: "The chain tip response was not a block height." };
      }
      return { ok: true, network, height };
    },
  });
}

module.exports = {
  getBalance,
  getUtxos,
  getFeeRates,
  broadcast,
  getTxs,
  getTipHeight,
  // Exported so the controller validates with the SAME rules the service applies,
  // rather than a second copy that drifts out of step.
  validateAddress,
  validateNetwork,
  validateRawTx,
  NETWORKS,
  MIN_RELAY_SAT_PER_VB,
};
