const WalletTx = require("../models/WalletTx");
const User = require("../models/User");
const { getChain, tokensFor } = require("../config/chains");
const rpcService = require("./rpc.service");
const { blockTimeFor } = require("../config/derivation");

const ANNOUNCE_WITHIN_SEC = 6 * 60 * 60;

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const SEL_SYMBOL = "0x95d89b41";
const SEL_NAME = "0x06fdde03";
const SEL_DECIMALS = "0x313ce567";

const MAX_BLOCK_SPAN = 1500;

function spanFor(chain) {
  const measured = Number(chain && chain.logSpan);
  const base = Number.isFinite(measured) && measured > 0 ? measured : MAX_BLOCK_SPAN;
  const cap = Number(process.env.WALLET_HISTORY_BLOCK_SPAN);
  return Number.isFinite(cap) && cap > 0 ? Math.min(base, cap) : base;
}

const LOOKBACK_WINDOWS = Number(process.env.WALLET_HISTORY_WINDOWS || 4);

const MAX_RESUME_WINDOWS = Number(process.env.WALLET_HISTORY_RESUME_WINDOWS || 8);

const RESUME_OVERLAP = 50;

const MAX_LOOKUPS_PER_SYNC = 10;
const MAX_LOOKUP_ATTEMPTS = 4;
const MAX_DISCOVERED_PER_CHAIN = 60;

const WELL_KNOWN = new Set([
  "ETH", "WETH", "BTC", "WBTC", "USDC", "USDT", "DAI", "BNB", "WBNB", "MATIC", "POL",
  "AVAX", "WAVAX", "ARB", "OP", "LINK", "UNI", "SOL", "XRP", "DOGE",
]);

async function rpc(chain, method, params) {
  return rpcService.rpcCall(chain, method, params);
}

function addressTopic(address) {
  return "0x" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

const MIN_DISCOVERY_SPAN = 100;
const DISCOVERY_RETRY_MS = 10 * 60 * 1000;
const discoverySpan = new Map();
const discoveryRefusedAt = new Map();

function attemptsOf(res) {
  return Array.isArray(res && res.attempts) ? res.attempts : [];
}

function refusedByNode(res) {
  if (!res || res.ok) return false;
  if (/^(rpc error|HTTP 4)/i.test(String(res.reason || ""))) return true;
  const attempts = attemptsOf(res);
  return attempts.length > 0 && attempts.every((a) => a.status >= 400 && a.status < 500);
}

function worthSplitting(res) {
  if (!refusedByNode(res)) return false;
  const reasons = [res.reason, ...attemptsOf(res).map((a) => a.reason)].filter(Boolean).join(" | ");
  return /range|span|block|too many|too large|limit|exceed|413|payload|-32614|-32005/i.test(reasons);
}

function rememberSpan(chainId, span) {
  const current = discoverySpan.get(chainId);
  if (!current || span < current) discoverySpan.set(chainId, span);
}

async function discoveryLogs(chain, address, from, to) {
  const size = to - from + 1;
  const cap = discoverySpan.get(chain.chainId);
  if (cap && size > cap) return splitDiscovery(chain, address, from, to, cap);
  const res = await rpcService.rpcCallTyped(chain, "eth_getLogs", [
    { topics: [TRANSFER_TOPIC, null, addressTopic(address)], fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16) },
  ]);
  if (res && res.ok && Array.isArray(res.result)) return { ok: true, logs: res.result, queries: 1 };
  const refused = refusedByNode(res);
  if (!worthSplitting(res) || size <= MIN_DISCOVERY_SPAN) return { ok: false, refused, queries: 1 };
  const out = await splitDiscovery(chain, address, from, to, Math.ceil(size / 2));
  return { ...out, queries: out.queries + 1 };
}

async function splitDiscovery(chain, address, from, to, piece) {
  const logs = [];
  let queries = 0;
  for (let start = from; start <= to; start += piece) {
    const part = await discoveryLogs(chain, address, start, Math.min(to, start + piece - 1));
    queries += part.queries;
    if (!part.ok) return { ok: false, refused: part.refused, queries };
    logs.push(...part.logs);
  }
  rememberSpan(chain.chainId, Math.max(piece, MIN_DISCOVERY_SPAN));
  return { ok: true, logs, queries };
}

async function discoverWindow(chain, address, from, to) {
  const refusedAt = discoveryRefusedAt.get(chain.chainId) || 0;
  if (Date.now() - refusedAt < DISCOVERY_RETRY_MS) return { ok: false, refused: true, queries: 0 };
  const out = await discoveryLogs(chain, address, from, to);
  if (!out.ok && out.refused) discoveryRefusedAt.set(chain.chainId, Date.now());
  return out;
}

function _resetDiscoveryForTests() {
  discoverySpan.clear();
  discoveryRefusedAt.clear();
}

function unitsToDecimalString(raw, decimals) {
  const v = BigInt(raw || 0);
  const d = BigInt(decimals);
  const divisor = 10n ** d;
  const whole = v / divisor;
  const frac = (v % divisor).toString().padStart(Number(d), "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

function decodeAbiString(hex) {
  if (typeof hex !== "string" || !hex.startsWith("0x") || hex === "0x") return null;
  const h = hex.slice(2);
  if (!/^[0-9a-fA-F]*$/.test(h)) return null;

  if (h.length === 64) {
    const buf = Buffer.from(h, "hex");
    const nul = buf.indexOf(0);
    return buf.subarray(0, nul === -1 ? buf.length : nul).toString("utf8");
  }
  if (h.length < 128) return null;

  let offset;
  let len;
  try {
    offset = Number(BigInt("0x" + h.slice(0, 64))) * 2;
    if (!Number.isFinite(offset) || offset + 64 > h.length) return null;
    len = Number(BigInt("0x" + h.slice(offset, offset + 64))) * 2;
  } catch {
    return null;
  }
  if (!Number.isFinite(len) || len < 0 || len > 4096) return null;
  const data = h.slice(offset + 64, offset + 64 + len);
  if (data.length < len) return null;
  return Buffer.from(data, "hex").toString("utf8");
}

const CONTROL_CHARS = new RegExp(
  "[" +
    String.fromCharCode(0) + "-" + String.fromCharCode(31) +
    String.fromCharCode(127) + "-" + String.fromCharCode(159) +
    String.fromCharCode(8203) + "-" + String.fromCharCode(8207) +
    String.fromCharCode(8232) + "-" + String.fromCharCode(8239) +
    String.fromCharCode(8288) + "-" + String.fromCharCode(8303) +
    String.fromCharCode(65279) +
  "]",
  "g"
);

function sanitizeText(value, max) {
  if (value == null) return null;
  const cleaned = String(value)
    .replace(CONTROL_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

async function readTokenMeta(chain, contract) {
  const call = (data) => rpc(chain, "eth_call", [{ to: contract, data }, "latest"]);
  const [symRaw, nameRaw, decRaw] = await Promise.all([
    call(SEL_SYMBOL),
    call(SEL_NAME),
    call(SEL_DECIMALS),
  ]);

  const symbol = sanitizeText(decodeAbiString(symRaw), 12);
  const name = sanitizeText(decodeAbiString(nameRaw), 48);

  let decimals = null;
  if (typeof decRaw === "string" && decRaw.startsWith("0x") && decRaw.length > 2) {
    const parsed = parseInt(decRaw, 16);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 36) decimals = parsed;
  }

  return {
    symbol,
    name,
    decimals,
    readable: Boolean(symbol) && decimals != null,
    anyMissing: symRaw === null || decRaw === null,
    transport: symRaw === null && nameRaw === null && decRaw === null,
  };
}

function impersonationOf(symbol, chain) {
  if (!symbol) return null;
  const upper = symbol.toUpperCase();
  const registry = new Set(
    [chain.nativeSymbol, ...tokensFor(chain).map((t) => t.symbol)]
      .filter(Boolean)
      .map((s) => String(s).toUpperCase())
  );
  if (registry.has(upper)) return upper;
  if (WELL_KNOWN.has(upper)) return upper;
  return null;
}

const inflight = new Map();

async function syncInboundTransfers(args) {
  const key = `${args.userId}:${args.chainId}`;
  if (inflight.has(key)) return inflight.get(key);
  const p = doSync(args).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

const EMPTY = { scanned: 0, added: 0, queries: 0, fromBlock: 0, discovered: 0, failed: false, limited: false, announced: 0 };

async function doSync({ userId, chainId, address }) {
  const chain = getChain(chainId);
  if (!chain || !address) return { ...EMPTY };

  const headHex = await rpc(chain, "eth_blockNumber", []);
  if (!headHex) return { ...EMPTY, failed: true };
  const head = parseInt(headHex, 16);
  if (!Number.isFinite(head)) return { ...EMPTY, failed: true };

  const owner = await User.findById(userId)
    .select("walletHistoryCursors customTokens discoveredTokens")
    .lean();
  if (!owner) return { ...EMPTY };

  const saved = (owner.walletHistoryCursors || []).find((c) => c.chainId === chain.chainId);
  const span = spanFor(chain);

  const known = new Map();
  for (const t of tokensFor(chain)) known.set(String(t.address).toLowerCase(), { ...t, custom: false });
  for (const t of owner.customTokens || []) {
    if (t.chainId === chain.chainId) known.set(String(t.address).toLowerCase(), { ...t, custom: true });
  }
  const discovered = new Map();
  for (const d of owner.discoveredTokens || []) {
    if (d.chainId === chain.chainId) discovered.set(String(d.address).toLowerCase(), d);
  }

  const windows = [];
  if (!saved) {
    for (let w = 0; w < LOOKBACK_WINDOWS; w++) {
      const to = head - w * span;
      const from = Math.max(0, to - span + 1);
      if (to <= 0 || from > to) break;
      windows.push({ from, to });
    }
  } else {
    let from = Math.max(0, saved.block - RESUME_OVERLAP);
    for (let w = 0; w < MAX_RESUME_WINDOWS && from <= head; w++) {
      const to = Math.min(head, from + span - 1);
      windows.push({ from, to });
      from = to + 1;
    }
  }

  let added = 0;
  let scanned = 0;
  const fresh = [];
  const keep = (row) => {
    if (!row) return 0;
    fresh.push(row);
    return 1;
  };
  let queries = 0;
  let lowest = head;
  let failed = false;
  let limited = false;
  let readTo = saved ? saved.block : null;
  const unknown = new Map();

  for (const w of windows) {
    const range = { fromBlock: "0x" + w.from.toString(16), toBlock: "0x" + w.to.toString(16) };
    const first = await discoverWindow(chain, address, w.from, w.to);
    queries += first.queries;
    let logs = first.ok ? first.logs : null;
    const refused = !first.ok && first.refused;

    if (!Array.isArray(logs) && refused && known.size) {
      queries++;
      const fallback = await rpc(chain, "eth_getLogs", [
        { address: Array.from(known.keys()), topics: [TRANSFER_TOPIC, null, addressTopic(address)], ...range },
      ]);
      if (Array.isArray(fallback)) {
        logs = fallback;
        limited = true;
      }
    }

    if (!Array.isArray(logs)) {
      failed = true;
      console.warn(
        `[walletHistory] ${chain.name}: log query ${w.from}-${w.to} failed; cursor held at ${
          readTo == null ? "none" : readTo
        }`
      );
      break;
    }

    scanned++;
    lowest = Math.min(lowest, w.from);
    if (saved) readTo = w.to;

    for (const log of logs) {
      if (!log || log.removed || !Array.isArray(log.topics) || log.topics.length !== 3) continue;
      const contract = String(log.address || "").toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(contract)) continue;

      const token = known.get(contract);
      if (token) {
        added += keep(await recordTransfer({ userId, chain, address, log, symbol: token.symbol, decimals: token.decimals, contract }));
        continue;
      }

      const seen = discovered.get(contract);
      if (seen) {
        if (seen.status !== "ignored" && seen.readable && seen.decimals != null) {
          const row = await recordTransfer({ userId, chain, address, log, symbol: seen.symbol, decimals: seen.decimals, contract });
          added += seen.status === "added" ? keep(row) : row ? 1 : 0;
        }
        continue;
      }

      const block = parseInt(log.blockNumber, 16);
      const prev = unknown.get(contract);
      if (!prev || (Number.isFinite(block) && block < prev.block)) {
        unknown.set(contract, { log, block: Number.isFinite(block) ? block : null });
      }
    }
  }

  let discoveredCount = 0;
  let lookups = 0;

  const retryable = [...discovered.values()].filter(
    (d) => !d.readable && d.status === "new" && (d.lookupAttempts || 0) < MAX_LOOKUP_ATTEMPTS
  );
  for (const d of retryable) {
    if (lookups >= MAX_LOOKUPS_PER_SYNC) break;
    lookups++;
    const meta = await readTokenMeta(chain, d.address);
    const set = {
      "discoveredTokens.$.lastLookupAt": new Date(),
      "discoveredTokens.$.lookupAttempts": (d.lookupAttempts || 0) + (meta.transport ? 0 : 1),
    };
    if (meta.readable) {
      set["discoveredTokens.$.symbol"] = meta.symbol;
      set["discoveredTokens.$.name"] = meta.name;
      set["discoveredTokens.$.decimals"] = meta.decimals;
      set["discoveredTokens.$.readable"] = true;
      set["discoveredTokens.$.impersonates"] = impersonationOf(meta.symbol, chain);
    } else if (meta.symbol || meta.name) {
      if (meta.symbol) set["discoveredTokens.$.symbol"] = meta.symbol;
      if (meta.name) set["discoveredTokens.$.name"] = meta.name;
    }
    await User.updateOne(
      { _id: userId, discoveredTokens: { $elemMatch: { chainId: chain.chainId, address: d.address } } },
      { $set: set }
    ).catch((err) => console.error("[walletHistory] discovery update failed:", err.message));
  }

  let onList = discovered.size;
  let capLogged = false;
  for (const [contract, { log, block }] of unknown) {
    if (onList >= MAX_DISCOVERED_PER_CHAIN) {
      if (!capLogged) {
        console.warn(
          `[walletHistory] ${chain.name}: discovery list is full (${MAX_DISCOVERED_PER_CHAIN}); further unknown contracts are not recorded`
        );
        capLogged = true;
      }
      break;
    }

    let meta = { symbol: null, name: null, decimals: null, readable: false, transport: true };
    let attempts = 0;
    if (lookups < MAX_LOOKUPS_PER_SYNC) {
      lookups++;
      meta = await readTokenMeta(chain, contract);
      attempts = meta.transport ? 0 : 1;
    }

    const entry = {
      chainId: chain.chainId,
      address: contract,
      symbol: meta.symbol,
      name: meta.name,
      decimals: meta.decimals,
      readable: meta.readable,
      lookupAttempts: attempts,
      lastLookupAt: lookups > 0 ? new Date() : null,
      impersonates: meta.readable ? impersonationOf(meta.symbol, chain) : null,
      firstSeenAt: new Date(),
      firstSeenBlock: block,
      firstTxHash: log.transactionHash || null,
      firstFrom: "0x" + String(log.topics[1] || "").slice(-40),
      firstAmount:
        meta.decimals != null ? safeUnits(log.data, meta.decimals) : null,
      status: "new",
      decidedAt: null,
    };

    try {
      const r = await User.updateOne(
        {
          _id: userId,
          discoveredTokens: { $not: { $elemMatch: { chainId: chain.chainId, address: contract } } },
        },
        { $push: { discoveredTokens: entry } }
      );
      if (r.modifiedCount) {
        discoveredCount++;
        onList++;
        console.log(
          `[walletHistory] ${chain.name}: new token ${meta.symbol || "(unreadable)"} at ${contract} arrived at ${address}`
        );
        if (meta.readable) {
          added += (await recordTransfer({ userId, chain, address, log, symbol: meta.symbol, decimals: meta.decimals, contract })) ? 1 : 0;
        }
      }
    } catch (err) {
      console.error("[walletHistory] discovery insert failed:", err.message);
    }
  }

  let commit = null;
  if (!saved) {
    if (!failed && windows.length) commit = head;
  } else if (readTo != null && readTo > saved.block) {
    commit = readTo;
  }

  if (commit != null) {
    try {
      const r = await User.updateOne(
        { _id: userId, "walletHistoryCursors.chainId": chain.chainId },
        { $set: { "walletHistoryCursors.$.block": commit } }
      );
      if (r.matchedCount === 0) {
        await User.updateOne(
          { _id: userId },
          { $push: { walletHistoryCursors: { chainId: chain.chainId, block: commit } } }
        );
      }
    } catch (err) {
      console.error("[walletHistory] cursor save failed:", err.message);
    }
  }

  let announced = 0;
  if (saved && fresh.length) {
    const recentFrom = head - Math.ceil(ANNOUNCE_WITHIN_SEC / blockTimeFor(chain.chainId));
    const { announceWalletTx } = require("./walletActivity.service");
    for (const row of fresh) {
      if (!Number.isFinite(row.blockNumber) || row.blockNumber < recentFrom) continue;
      announced += 1;
      announceWalletTx(row._id).catch((err) => console.error("[walletHistory] announce failed:", err.message));
    }
  }

  return { scanned, added, queries, fromBlock: lowest, discovered: discoveredCount, failed, limited, announced };
}

function safeUnits(dataHex, decimals) {
  try {
    return unitsToDecimalString(BigInt(dataHex || "0x0"), decimals);
  } catch {
    return null;
  }
}

async function recordTransfer({ userId, chain, address, log, symbol, decimals, contract }) {
  try {
    const existing = await WalletTx.findOne({ hash: log.transactionHash, userId })
      .select("_id")
      .lean();
    if (existing) return null;

    const value = safeUnits(log.data, decimals);
    if (value == null) return null;

    return await WalletTx.create({
      userId,
      chainId: chain.chainId,
      hash: log.transactionHash,
      from: "0x" + String(log.topics[1] || "").slice(-40),
      to: address,
      value,
      symbol,
      tokenAddress: contract,
      direction: "in",
      status: "confirmed",
      kind: "transfer",
      blockNumber: parseInt(log.blockNumber, 16),
      notifiedAt: null,
    });
  } catch (err) {
    if (err.code !== 11000) console.error("[walletHistory] insert failed:", err.message);
    return null;
  }
}

module.exports = {
  syncInboundTransfers,
  readTokenMeta,
  impersonationOf,
  decodeAbiString,
  sanitizeText,
  spanFor,
  discoverWindow,
  _resetDiscoveryForTests,
  MIN_DISCOVERY_SPAN,
  MAX_DISCOVERED_PER_CHAIN,
  MAX_LOOKUP_ATTEMPTS,
};
