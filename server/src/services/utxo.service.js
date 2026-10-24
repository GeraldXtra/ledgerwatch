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

const BECH32_BODY = "[02-9ac-hj-np-z]{11,87}";
const BASE58_BODY = "[1-9A-HJ-NP-Za-km-z]{25,39}";

function blockcypherToken() {
  const t = String(process.env.BLOCKCYPHER_TOKEN || "").trim();
  return /^[A-Za-z0-9._-]{16,256}$/.test(t) ? t : null;
}

function blockchairKey() {
  const k = String(process.env.BLOCKCHAIR_API_KEY || "").trim();
  return /^[A-Za-z0-9._-]{8,128}$/.test(k) ? k : null;
}

const COINS = {
  bitcoin: {
    label: "Bitcoin",
    log: "btc",
    symbol: "BTC",
    unit: "sat/vB",
    minRelay: 1,
    networks: {
      mainnet: [
        { base: "https://blockstream.info/api", flavour: "esplora" },
        { base: "https://mempool.space/api", flavour: "mempool" },
      ],
      testnet: [
        { base: "https://blockstream.info/testnet/api", flavour: "esplora" },
        { base: "https://mempool.space/testnet/api", flavour: "mempool" },
      ],
    },
    address: {
      mainnet: new RegExp(`^(bc1${BECH32_BODY}|[13]${BASE58_BODY})$`),
      testnet: new RegExp(`^(tb1${BECH32_BODY}|[mn2]${BASE58_BODY})$`),
    },
    bech32: { mainnet: "bc1", testnet: "tb1" },
    expected: { mainnet: "bc1, 1 or 3", testnet: "tb1, m, n or 2" },
  },
  litecoin: {
    label: "Litecoin",
    log: "ltc",
    symbol: "LTC",
    unit: "lit/vB",
    minRelay: 1,
    networks: {
      mainnet: [{ base: "https://litecoinspace.org/api", flavour: "mempool" }],
      testnet: [{ base: "https://litecoinspace.org/testnet/api", flavour: "mempool" }],
    },
    address: {
      mainnet: new RegExp(`^(ltc1${BECH32_BODY}|[LM3]${BASE58_BODY})$`),
      testnet: new RegExp(`^(tltc1${BECH32_BODY}|[mnQ2]${BASE58_BODY})$`),
    },
    bech32: { mainnet: "ltc1", testnet: "tltc1" },
    expected: { mainnet: "ltc1, L or M", testnet: "tltc1, m, n or Q" },
  },
  dogecoin: {
    label: "Dogecoin",
    log: "doge",
    symbol: "DOGE",
    unit: "koinu/byte",
    minRelay: 1000,
    networks: {
      mainnet: [
        { base: "https://api.blockcypher.com/v1/doge/main", flavour: "blockcypher" },
        { base: "https://api.blockchair.com/dogecoin", flavour: "blockchair" },
      ],
    },
    address: {
      mainnet: new RegExp(`^[DA9]${BASE58_BODY}$`),
    },
    bech32: {},
    expected: { mainnet: "D, A or 9" },
  },
};

function validateCoin(coin) {
  const c = coin == null || coin === "" ? "bitcoin" : coin;
  if (typeof c !== "string" || !Object.prototype.hasOwnProperty.call(COINS, c)) {
    return { ok: false, kind: "invalid", reason: `Coin must be one of ${Object.keys(COINS).join(", ")}.` };
  }
  return { ok: true, coin: c, config: COINS[c] };
}

function validateNetwork(network, coin = "bitcoin") {
  const c = validateCoin(coin);
  if (!c.ok) return c;
  const networks = Object.keys(c.config.networks);
  if (typeof network !== "string" || !networks.includes(network)) {
    return {
      ok: false,
      kind: "invalid",
      reason:
        networks.length === 1
          ? `${c.config.label} is available on ${networks[0]} only.`
          : `Network must be either "${networks.join('" or "')}".`,
    };
  }
  return { ok: true, network, coin: c.coin, config: c.config };
}

function validateAddress(address, network, coin = "bitcoin") {
  const net = validateNetwork(network, coin);
  if (!net.ok) return net;
  const { config } = net;

  if (typeof address !== "string" || address.length === 0) {
    return { ok: false, kind: "invalid", reason: "An address is required." };
  }
  if (address.length > 90) {
    return { ok: false, kind: "invalid", reason: `That address is too long to be a ${config.label} address.` };
  }
  const hrp = config.bech32[network];
  const candidate = hrp && address.startsWith(hrp.toUpperCase()) ? address.toLowerCase() : address;

  if (!config.address[network].test(candidate)) {
    return {
      ok: false,
      kind: "invalid",
      reason: `That is not a valid ${network} ${config.label} address. A ${network} address starts with ${config.expected[network]}.`,
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

function validateTxid(txid) {
  const t = typeof txid === "string" ? txid.trim().toLowerCase() : "";
  return /^[0-9a-f]{64}$/.test(t)
    ? { ok: true, txid: t }
    : { ok: false, kind: "invalid", reason: "A transaction id is 64 hexadecimal characters." };
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
const PRE_ACCEPT_STATUS = new Set([401, 402, 403, 404, 405, 429, 430]);

function shouldFallThrough({ isBroadcast, status, code }) {
  const preAccept = (code && PRE_ACCEPT_CODES.has(code)) || (status && PRE_ACCEPT_STATUS.has(status));
  if (preAccept) return true;
  if (isBroadcast) return false;
  return true;
}

function withKey(ep, url) {
  if (ep.flavour === "blockcypher" && blockcypherToken()) {
    return `${url}${url.includes("?") ? "&" : "?"}token=${blockcypherToken()}`;
  }
  if (ep.flavour === "blockchair" && blockchairKey()) {
    return `${url}${url.includes("?") ? "&" : "?"}key=${blockchairKey()}`;
  }
  return url;
}

async function fetchOnce(url, { method, body, contentType, timeoutMs }) {
  await acquire();
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": contentType || "text/plain" } : undefined,
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

async function callAcross(net, spec) {
  const { network, config } = net;
  const endpoints = config.networks[network];
  const timeoutMs = spec.timeoutMs || DEFAULT_TIMEOUT_MS;
  const attempts = [];

  for (let i = 0; i < endpoints.length; i++) {
    const ep = endpoints[i];
    const request = spec.request ? spec.request(ep) : { body: spec.body, contentType: spec.contentType };
    const url = withKey(ep, `${ep.base}${spec.path(ep)}`);
    const host = endpointHost(url);

    const r = await fetchOnce(url, {
      method: spec.method || "GET",
      body: request.body,
      contentType: request.contentType,
      timeoutMs,
    });

    if (r.ok) {
      if (i > 0) {
        console.warn(
          `[${config.log}] ${network}: endpoint ${i + 1}/${endpoints.length} (${host}) served ${spec.label} ` +
            `after ${i} failure(s) — the preferred endpoint is degraded`
        );
      }
      const parsed = spec.parse(r.text, ep);
      if (!parsed.ok) {
        console.error(`[${config.log}] ${network}: ${host} answered ${spec.label} with a body we cannot read — ${parsed.reason}`);
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
        `[${config.log}] ${network}: ${host} failed a BROADCAST ambiguously (${reason}). Not retrying elsewhere — ` +
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
  console.error(`[${config.log}] ${network}: ${spec.label} failed on all ${endpoints.length} endpoint(s) — ${summary}`);

  const anyAnswered = attempts.some((a) => a.status > 0);
  return {
    ok: false,
    kind: anyAnswered ? "upstream" : "unreachable",
    reason: attempts.length
      ? `No ${config.label} ${network} endpoint could answer. Last reason: ${attempts[attempts.length - 1].reason}.`
      : `No ${config.label} ${network} endpoint is configured.`,
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

function toUnits(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function chairRow(body, key) {
  const data = body && body.data;
  if (!data || typeof data !== "object") return null;
  return data[key] || null;
}

async function getBalance(address, network, coin = "bitcoin") {
  const a = validateAddress(address, network, coin);
  if (!a.ok) return a;
  const net = validateNetwork(network, coin);

  return callAcross(net, {
    label: "balance",
    path: (ep) =>
      ep.flavour === "blockcypher"
        ? `/addrs/${encodeURIComponent(a.address)}/balance`
        : ep.flavour === "blockchair"
          ? `/dashboards/address/${encodeURIComponent(a.address)}?limit=0`
          : `/address/${encodeURIComponent(a.address)}`,
    parse(text, ep) {
      const p = parseJson(text, "balance");
      if (!p.ok) return p;
      const body = p.value;
      if (ep.flavour === "blockcypher") {
        if (!body || typeof body.balance === "undefined") {
          return { ok: false, kind: "unparseable", reason: "The balance response did not contain a balance." };
        }
        const confirmed = toUnits(body.balance);
        const pending = toUnits(body.unconfirmed_balance);
        return { ok: true, address: a.address, network, coin: net.coin, confirmed, pending, total: confirmed + pending, txCount: toUnits(body.final_n_tx) };
      }
      if (ep.flavour === "blockchair") {
        const row = chairRow(body, a.address);
        if (!row || !row.address || typeof row.address.balance === "undefined") {
          return { ok: false, kind: "unparseable", reason: "The balance response did not contain a balance." };
        }
        const confirmed = toUnits(row.address.balance);
        return { ok: true, address: a.address, network, coin: net.coin, confirmed, pending: 0, total: confirmed, txCount: toUnits(row.address.transaction_count) };
      }
      const chain = body && body.chain_stats;
      const pool = body && body.mempool_stats;
      if (!chain || typeof chain.funded_txo_sum === "undefined") {
        return { ok: false, kind: "unparseable", reason: "The balance response did not contain chain statistics." };
      }
      const confirmed = toUnits(chain.funded_txo_sum) - toUnits(chain.spent_txo_sum);
      const pending = pool ? toUnits(pool.funded_txo_sum) - toUnits(pool.spent_txo_sum) : 0;
      return {
        ok: true,
        address: a.address,
        network,
        coin: net.coin,
        confirmed,
        pending,
        total: confirmed + pending,
        txCount: toUnits(chain.tx_count) + (pool ? toUnits(pool.tx_count) : 0),
      };
    },
  });
}

const UTXO_LIMIT = 200;

async function getUtxos(address, network, coin = "bitcoin") {
  const a = validateAddress(address, network, coin);
  if (!a.ok) return a;
  const net = validateNetwork(network, coin);

  return callAcross(net, {
    label: "utxos",
    path: (ep) =>
      ep.flavour === "blockcypher"
        ? `/addrs/${encodeURIComponent(a.address)}?unspentOnly=true&includeScript=false&limit=${UTXO_LIMIT}`
        : ep.flavour === "blockchair"
          ? `/dashboards/address/${encodeURIComponent(a.address)}?limit=${UTXO_LIMIT}`
          : `/address/${encodeURIComponent(a.address)}/utxo`,
    parse(text, ep) {
      const p = parseJson(text, "utxo");
      if (!p.ok) return p;
      let utxos;
      let truncated = false;
      if (ep.flavour === "blockcypher") {
        const body = p.value || {};
        const refs = [...(Array.isArray(body.txrefs) ? body.txrefs : []), ...(Array.isArray(body.unconfirmed_txrefs) ? body.unconfirmed_txrefs : [])];
        utxos = refs
          .filter((u) => u && u.spent !== true && Number(u.tx_output_n) >= 0)
          .map((u) => ({
            txid: String(u.tx_hash || ""),
            vout: Number(u.tx_output_n),
            value: toUnits(u.value),
            confirmed: Number(u.confirmations || 0) > 0,
            blockHeight: u.block_height != null && Number(u.block_height) > 0 ? Number(u.block_height) : null,
          }));
        truncated = Boolean(body.hasMore);
      } else if (ep.flavour === "blockchair") {
        const row = chairRow(p.value, a.address);
        if (!row || !Array.isArray(row.utxo)) {
          return { ok: false, kind: "unparseable", reason: "The utxo response did not contain a list." };
        }
        utxos = row.utxo.map((u) => ({
          txid: String(u.transaction_hash || ""),
          vout: Number(u.index || 0),
          value: toUnits(u.value),
          confirmed: Number(u.block_id) > 0,
          blockHeight: Number(u.block_id) > 0 ? Number(u.block_id) : null,
        }));
        truncated = row.address && Number(row.address.unspent_output_count) > utxos.length;
      } else {
        if (!Array.isArray(p.value)) {
          return { ok: false, kind: "unparseable", reason: "The utxo response was not a list." };
        }
        utxos = p.value.map((u) => ({
          txid: String(u.txid || ""),
          vout: Number(u.vout || 0),
          value: toUnits(u.value),
          confirmed: Boolean(u.status && u.status.confirmed),
          blockHeight: u.status && u.status.block_height != null ? Number(u.status.block_height) : null,
        }));
      }
      if (utxos.some((u) => !/^[0-9a-f]{64}$/i.test(u.txid))) {
        return { ok: false, kind: "unparseable", reason: "The utxo response contained a malformed transaction id." };
      }
      return {
        ok: true,
        address: a.address,
        network,
        coin: net.coin,
        utxos,
        truncated,
        total: utxos.reduce((sum, u) => sum + u.value, 0),
      };
    },
  });
}

async function getFeeRates(network, coin = "bitcoin") {
  const net = validateNetwork(network, coin);
  if (!net.ok) return net;
  const floor = (v) => Math.max(net.config.minRelay, Math.ceil(Number(v) || 0));

  return callAcross(net, {
    label: "fees",
    path: (ep) =>
      ep.flavour === "mempool"
        ? "/v1/fees/recommended"
        : ep.flavour === "blockcypher"
          ? ""
          : ep.flavour === "blockchair"
            ? "/stats"
            : "/fee-estimates",
    parse(text, ep) {
      const p = parseJson(text, "fee");
      if (!p.ok) return p;
      const body = p.value;
      const base = { ok: true, network, coin: net.coin, unit: net.config.unit };

      if (ep.flavour === "blockcypher") {
        if (!body || typeof body.medium_fee_per_kb === "undefined") {
          return { ok: false, kind: "unparseable", reason: "The fee response did not contain fee estimates." };
        }
        const perByte = (kb) => floor(Number(kb) / 1000);
        return {
          ...base,
          source: "blockcypher",
          fast: perByte(body.high_fee_per_kb),
          medium: perByte(body.medium_fee_per_kb),
          slow: perByte(body.low_fee_per_kb),
          byTarget: {},
        };
      }
      if (ep.flavour === "blockchair") {
        const v = body && body.data && body.data.suggested_transaction_fee_per_byte_sat;
        if (!Number.isFinite(Number(v))) {
          return { ok: false, kind: "unparseable", reason: "The fee response did not contain a suggested fee." };
        }
        return { ...base, source: "blockchair", fast: floor(v), medium: floor(v), slow: floor(v), byTarget: {} };
      }
      if (ep.flavour === "mempool") {
        if (!body || typeof body.fastestFee === "undefined") {
          return { ok: false, kind: "unparseable", reason: "The fee response did not contain recommended rates." };
        }
        return {
          ...base,
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
      return { ...base, source: "esplora", fast: at(1), medium: at(6), slow: at(144), byTarget };
    },
  });
}

async function broadcast(rawHexTx, network, coin = "bitcoin") {
  const net = validateNetwork(network, coin);
  if (!net.ok) return net;
  const t = validateRawTx(rawHexTx);
  if (!t.ok) return t;

  return callAcross(net, {
    label: "broadcast",
    method: "POST",
    isBroadcast: true,
    path: (ep) => (ep.flavour === "blockcypher" ? "/txs/push" : ep.flavour === "blockchair" ? "/push/transaction" : "/tx"),
    request: (ep) =>
      ep.flavour === "blockcypher"
        ? { body: JSON.stringify({ tx: t.rawTx }), contentType: "application/json" }
        : ep.flavour === "blockchair"
          ? { body: `data=${t.rawTx}`, contentType: "application/x-www-form-urlencoded" }
          : { body: t.rawTx, contentType: "text/plain" },
    parse(text, ep) {
      let txid = "";
      if (ep.flavour === "blockcypher") {
        const p = parseJson(text, "broadcast");
        txid = p.ok && p.value && p.value.tx ? String(p.value.tx.hash || "") : "";
      } else if (ep.flavour === "blockchair") {
        const p = parseJson(text, "broadcast");
        txid = p.ok && p.value && p.value.data ? String(p.value.data.transaction_hash || "") : "";
      } else {
        txid = (text || "").trim();
      }
      if (!/^[0-9a-f]{64}$/.test(txid)) {
        return {
          ok: false,
          kind: "unparseable",
          reason: "The network accepted the transaction but did not return a usable transaction id.",
        };
      }
      return { ok: true, txid, network, coin: net.coin };
    },
  });
}

async function getRawTx(txid, network, coin = "bitcoin") {
  const net = validateNetwork(network, coin);
  if (!net.ok) return net;
  const id = validateTxid(txid);
  if (!id.ok) return id;

  return callAcross(net, {
    label: "raw transaction",
    path: (ep) =>
      ep.flavour === "blockcypher"
        ? `/txs/${id.txid}?includeHex=true&limit=1`
        : ep.flavour === "blockchair"
          ? `/raw/transaction/${id.txid}`
          : `/tx/${id.txid}/hex`,
    parse(text, ep) {
      let hex = "";
      if (ep.flavour === "blockcypher") {
        const p = parseJson(text, "raw transaction");
        hex = p.ok && p.value ? String(p.value.hex || "") : "";
      } else if (ep.flavour === "blockchair") {
        const p = parseJson(text, "raw transaction");
        const row = p.ok ? chairRow(p.value, id.txid) : null;
        hex = row ? String(row.raw_transaction || "") : "";
      } else {
        hex = (text || "").trim();
      }
      const check = validateRawTx(hex);
      if (!check.ok) return { ok: false, kind: "unparseable", reason: "The raw transaction response was not usable hex." };
      return { ok: true, txid: id.txid, hex: check.rawTx, network, coin: net.coin };
    },
  });
}

async function getTxs(address, network, coin = "bitcoin") {
  const a = validateAddress(address, network, coin);
  if (!a.ok) return a;
  const net = validateNetwork(network, coin);

  return callAcross(net, {
    label: "txs",
    path: (ep) =>
      ep.flavour === "blockcypher"
        ? `/addrs/${encodeURIComponent(a.address)}/full?limit=25&txlimit=50`
        : ep.flavour === "blockchair"
          ? `/dashboards/address/${encodeURIComponent(a.address)}?limit=25&transaction_details=true`
          : `/address/${encodeURIComponent(a.address)}/txs`,
    parse(text, ep) {
      const p = parseJson(text, "transaction");
      if (!p.ok) return p;
      let txs;
      if (ep.flavour === "blockcypher") {
        const list = p.value && Array.isArray(p.value.txs) ? p.value.txs : null;
        if (!list) return { ok: false, kind: "unparseable", reason: "The transaction response was not a list." };
        txs = list.map((tx) => {
          const received = (tx.outputs || [])
            .filter((o) => Array.isArray(o.addresses) && o.addresses.includes(a.address))
            .reduce((s, o) => s + toUnits(o.value), 0);
          const sent = (tx.inputs || [])
            .filter((i) => Array.isArray(i.addresses) && i.addresses.includes(a.address))
            .reduce((s, i) => s + toUnits(i.output_value), 0);
          const delta = received - sent;
          return {
            txid: String(tx.hash || ""),
            confirmed: Number(tx.confirmations || 0) > 0,
            blockHeight: Number(tx.block_height) > 0 ? Number(tx.block_height) : null,
            blockTime: tx.confirmed ? Math.floor(new Date(tx.confirmed).getTime() / 1000) : null,
            fee: toUnits(tx.fees),
            valueDelta: delta,
            direction: delta >= 0 ? "in" : "out",
          };
        });
      } else if (ep.flavour === "blockchair") {
        const row = chairRow(p.value, a.address);
        if (!row || !Array.isArray(row.transactions)) {
          return { ok: false, kind: "unparseable", reason: "The transaction response was not a list." };
        }
        txs = row.transactions.map((tx) => {
          const delta = toUnits(tx.balance_change);
          return {
            txid: String(tx.hash || ""),
            confirmed: Number(tx.block_id) > 0,
            blockHeight: Number(tx.block_id) > 0 ? Number(tx.block_id) : null,
            blockTime: tx.time ? Math.floor(new Date(`${tx.time}Z`).getTime() / 1000) : null,
            fee: null,
            valueDelta: delta,
            direction: delta >= 0 ? "in" : "out",
          };
        });
      } else {
        if (!Array.isArray(p.value)) {
          return { ok: false, kind: "unparseable", reason: "The transaction response was not a list." };
        }
        txs = p.value.map((tx) => {
          const outs = Array.isArray(tx.vout) ? tx.vout : [];
          const ins = Array.isArray(tx.vin) ? tx.vin : [];
          const received = outs
            .filter((o) => o && o.scriptpubkey_address === a.address)
            .reduce((sum, o) => sum + toUnits(o.value), 0);
          const sent = ins
            .filter((i) => i && i.prevout && i.prevout.scriptpubkey_address === a.address)
            .reduce((sum, i) => sum + toUnits(i.prevout.value), 0);
          const delta = received - sent;
          return {
            txid: String(tx.txid || ""),
            confirmed: Boolean(tx.status && tx.status.confirmed),
            blockHeight: tx.status && tx.status.block_height != null ? Number(tx.status.block_height) : null,
            blockTime: tx.status && tx.status.block_time != null ? Number(tx.status.block_time) : null,
            fee: toUnits(tx.fee),
            valueDelta: delta,
            direction: delta >= 0 ? "in" : "out",
          };
        });
      }
      return { ok: true, address: a.address, network, coin: net.coin, txs };
    },
  });
}

async function getTipHeight(network, coin = "bitcoin") {
  const net = validateNetwork(network, coin);
  if (!net.ok) return net;

  return callAcross(net, {
    label: "tip height",
    path: (ep) => (ep.flavour === "blockcypher" ? "" : ep.flavour === "blockchair" ? "/stats" : "/blocks/tip/height"),
    parse(text, ep) {
      let height;
      if (ep.flavour === "blockcypher") {
        const p = parseJson(text, "tip height");
        height = p.ok && p.value ? Number(p.value.height) : NaN;
      } else if (ep.flavour === "blockchair") {
        const p = parseJson(text, "tip height");
        height = p.ok && p.value && p.value.data ? Number(p.value.data.blocks) : NaN;
      } else {
        height = Number((text || "").trim());
      }
      if (!Number.isInteger(height) || height <= 0) {
        return { ok: false, kind: "unparseable", reason: "The chain tip response was not a block height." };
      }
      return { ok: true, network, coin: net.coin, height };
    },
  });
}

function coinsAvailable() {
  return Object.entries(COINS).map(([coin, c]) => ({
    coin,
    label: c.label,
    symbol: c.symbol,
    unit: c.unit,
    networks: Object.keys(c.networks),
  }));
}

module.exports = {
  COINS,
  coinsAvailable,
  validateCoin,
  validateNetwork,
  validateAddress,
  validateRawTx,
  getBalance,
  getUtxos,
  getFeeRates,
  broadcast,
  getRawTx,
  getTxs,
  getTipHeight,
};
