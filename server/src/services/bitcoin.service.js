const { describeError, endpointHost } = require("./rpc.service");

const DEFAULT_TIMEOUT_MS = Number(process.env.BITCOIN_API_TIMEOUT_MS || 12000);

const MAX_CONCURRENT = Number(process.env.BITCOIN_MAX_CONCURRENT || 4);

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

const BECH32_BODY = "[02-9ac-hj-np-z]{11,87}";
const BASE58_BODY = "[1-9A-HJ-NP-Za-km-z]{25,39}";

const ADDRESS_RE = {
  mainnet: new RegExp(`^(bc1${BECH32_BODY}|[13]${BASE58_BODY})$`),
  testnet: new RegExp(`^(tb1${BECH32_BODY}|[mn2]${BASE58_BODY})$`),
};

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

function validateAddress(address, network) {
  const net = validateNetwork(network);
  if (!net.ok) return net;

  if (typeof address !== "string" || address.length === 0) {
    return { ok: false, kind: "invalid", reason: "An address is required." };
  }
  if (address.length > 90) {
    return { ok: false, kind: "invalid", reason: "That address is too long to be a Bitcoin address." };
  }
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

const RAW_TX_MAX_HEX = 200000;

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
  if (hex.length < 40) {
    return { ok: false, kind: "invalid", reason: "That transaction is too short to be a real transaction." };
  }
  if (hex.length > RAW_TX_MAX_HEX) {
    return { ok: false, kind: "invalid", reason: "That transaction is larger than the network will relay." };
  }
  return { ok: true, rawTx: hex };
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

function shouldFallThrough({ isBroadcast, status, code }) {
  const preAccept = (code && PRE_ACCEPT_CODES.has(code)) || (status && PRE_ACCEPT_STATUS.has(status));
  if (preAccept) return true;
  if (isBroadcast) return false;
  return true;
}

async function fetchOnce(url, { method, body, timeoutMs }) {
  await acquire();
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "text/plain" } : undefined,
      body,
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

function parseJson(text, label) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, kind: "unparseable", reason: `The ${label} response was not valid JSON.` };
  }
}

function toSats(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

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
        pending,
        total: confirmed + pending,
        txCount: toSats(chain.tx_count) + (pool ? toSats(pool.tx_count) : 0),
      };
    },
  });
}

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
          valueDelta: delta,
          direction: delta >= 0 ? "in" : "out",
        };
      });
      return { ok: true, address: a.address, network, txs };
    },
  });
}

async function getTipHeight(network) {
  const net = validateNetwork(network);
  if (!net.ok) return net;

  return callAcross(network, {
    label: "tip height",
    path: () => "/blocks/tip/height",
    parse(text) {
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
  validateAddress,
  validateNetwork,
  validateRawTx,
  NETWORKS,
  MIN_RELAY_SAT_PER_VB,
};
