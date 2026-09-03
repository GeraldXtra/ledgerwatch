const WalletTx = require("../models/WalletTx");
const User = require("../models/User");
const { getChain, tokensFor } = require("../config/chains");
// Held as the module object, not destructured: the chain is this service's
// one external seam, and the regression test for LW-025 replaces `rpcCall`
// on it. Node's CommonJS loader is outside vitest's module mocking.
const rpcService = require("./rpc.service");

/**
 * INBOUND TRANSFER DISCOVERY, AND NEW TOKEN DETECTION.
 *
 * `WalletTx` rows have only ever come from `recordTx`, which the app calls when
 * IT sends something. So money arriving from anywhere else — an exchange, a
 * client paying you, a swap's output — produced no record at all, and History
 * looked empty on a wallet that had genuinely received funds.
 *
 * This reads Transfer logs addressed TO the wallet and upserts them. The unique
 * index on `hash` makes it idempotent, so it can run on every load without
 * duplicating anything.
 *
 * WHAT CHANGED, AND WHY.
 *
 * 1. ONE QUERY PER WINDOW, NOT ONE PER TOKEN. The previous version asked for
 *    Transfer logs filtered to each registry contract in turn, which meant it
 *    could only ever see tokens it already knew about. A token nobody told the
 *    wallet about could arrive, sit there with a real balance, and never be
 *    shown anywhere. The filter is now on the recipient topic alone, so every
 *    ERC-20 transfer to this wallet is visible, and it is also fewer requests.
 *
 * 2. UNKNOWN CONTRACTS ARE LOOKED UP AND RECORDED, NEVER AUTO-ADDED. On a
 *    real network most unsolicited tokens are spam or phishing bait, so the
 *    contract is read (symbol, name, decimals), recorded on the user as a
 *    discovery, and the wallet asks the owner what to do. A symbol that copies
 *    a verified registry token on the same chain is flagged as impersonation.
 *
 * 3. THE CURSOR ONLY ADVANCES OVER BLOCKS THAT WERE ACTUALLY READ (LW-025).
 *    It used to be set to `head` unconditionally, so a failed log query left a
 *    window permanently unread with nothing to say so. Now a resume walks
 *    forward from the saved cursor and commits each window as it succeeds;
 *    the first window that fails stops the walk and the cursor stays there.
 *    A first-time lookback commits only if every window succeeded, and is
 *    otherwise retried whole on the next load.
 *
 * 4. A LONG GAP CATCHES UP RATHER THAN BEING SKIPPED (LW-025). A resume used
 *    to read at most four windows back from head and then jump the cursor to
 *    head anyway, so anything older than that was lost forever. It now reads
 *    forward from the cursor, several windows per load, and leaves the cursor
 *    at the last block read, so a wallet that was not opened for a week is
 *    caught up over a few loads instead of skipping the week.
 *
 * Server-side because `eth_getLogs` is deliberately absent from the browser
 * facing RPC allowlist, exactly as the payment watcher does it.
 *
 * KNOWN LIMITS, on purpose. Native coin arrivals (ETH, BNB, MATIC…) emit no
 * Transfer log and cannot be discovered this way; the balance itself is the
 * record. Two token transfers in one transaction share a hash and the unique
 * index keeps the first; the second is visible on the explorer.
 */

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// ERC-20 selectors, read with eth_call. decimals() is the one that matters:
// getting it wrong misreads every balance by a power of ten.
const SEL_SYMBOL = "0x95d89b41";
const SEL_NAME = "0x06fdde03";
const SEL_DECIMALS = "0x313ce567";

/**
 * Blocks per eth_getLogs query. The registry's MEASURED `logSpan` wins; the
 * env var is a CAP for an operator who needs to go narrower on a node that is
 * misbehaving, never a way to exceed what was measured. Same precedence as the
 * payment watcher, because the two must agree about what a chain can serve.
 */
const MAX_BLOCK_SPAN = 1500;

function spanFor(chain) {
  const measured = Number(chain && chain.logSpan);
  const base = Number.isFinite(measured) && measured > 0 ? measured : MAX_BLOCK_SPAN;
  const cap = Number(process.env.WALLET_HISTORY_BLOCK_SPAN);
  return Number.isFinite(cap) && cap > 0 ? Math.min(base, cap) : base;
}

// How far back a FIRST scan reaches. Bounded on purpose: a full-history walk
// would be thousands of queries for a wallet that is usually days old.
const LOOKBACK_WINDOWS = Number(process.env.WALLET_HISTORY_WINDOWS || 4);

// How many windows a RESUME may read in one load. Enough to catch up a day on
// a slow chain in a couple of loads without turning one History open into a
// long stall; the cursor carries the rest to the next load.
const MAX_RESUME_WINDOWS = Number(process.env.WALLET_HISTORY_RESUME_WINDOWS || 8);

// A little overlap on resume, so a transfer mined at the boundary while the
// previous sync was mid-flight cannot fall between the two runs.
const RESUME_OVERLAP = 50;

// Contract lookups per sync, so an airdrop of a hundred spam tokens costs a
// few calls now and a few more next time rather than a hundred at once. The
// rest are recorded unread and looked up on later loads.
const MAX_LOOKUPS_PER_SYNC = 10;
// Retries for a contract that would not answer. Past this it is shown as
// "did not answer as a standard token" rather than "still checking".
const MAX_LOOKUP_ATTEMPTS = 4;
// Discovery rows per chain per user. A wallet that has been spammed past this
// keeps the first sixty and logs the rest; nothing about real money depends on
// this list, it is a recommendation surface.
const MAX_DISCOVERED_PER_CHAIN = 60;

// Symbols that are worth calling out when an unverified contract claims them.
// The chain's own registry symbols are added at run time.
const WELL_KNOWN = new Set([
  "ETH", "WETH", "BTC", "WBTC", "USDC", "USDT", "DAI", "BNB", "WBNB", "MATIC", "POL",
  "AVAX", "WAVAX", "ARB", "OP", "LINK", "UNI", "SOL", "XRP", "DOGE",
]);

/**
 * Delegated to the shared rpc service: endpoint fallback and a request timeout,
 * decided in one place rather than re-implemented here. The previous local copy
 * logged `err.message`, which for a transport failure is always the bare string
 * "fetch failed" and names nothing.
 */
async function rpc(chain, method, params) {
  return rpcService.rpcCall(chain, method, params);
}

function addressTopic(address) {
  return "0x" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

/** Raw token units -> decimal string, without going through a float. */
function unitsToDecimalString(raw, decimals) {
  const v = BigInt(raw || 0);
  const d = BigInt(decimals);
  const divisor = 10n ** d;
  const whole = v / divisor;
  const frac = (v % divisor).toString().padStart(Number(d), "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

/**
 * Decode an ABI `string` return. Two shapes exist in the wild: the standard
 * dynamic string (offset word, length word, bytes) and a bare bytes32 that a
 * few old contracts (MKR is the famous one) return instead. Anything that does
 * not fit either is null, never a guess.
 */
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
  // A "string" longer than this is not a token name, it is a payload.
  if (!Number.isFinite(len) || len < 0 || len > 4096) return null;
  const data = h.slice(offset + 64, offset + 64 + len);
  if (data.length < len) return null;
  return Buffer.from(data, "hex").toString("utf8");
}

/**
 * What the contract said, made safe to show. Control characters and anything
 * outside printable text are dropped, whitespace collapsed, length capped.
 * React escapes markup on render; this is about not rendering a symbol that is
 * forty zero-width characters followed by "USDC".
 */
// C0 and C1 controls, zero-width and bidi marks, the byte order mark. Built
// from character codes so no editor or tool can turn the escapes into the raw
// bytes they name, which is exactly what happened to the first version.
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
    // C0 and C1 controls, zero-width and bidi marks, the byte order mark.
    .replace(CONTROL_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

/**
 * Read symbol, name and decimals from a contract. `readable` is true only when
 * BOTH symbol and decimals came back sane; a token without those two cannot be
 * shown with a correct balance and must not be addable.
 */
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
    // Distinguish "the node did not answer" from "the contract answered with
    // nothing": the former is worth retrying, the latter is not a token.
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

/**
 * One sync at a time per wallet per chain. The wallet page and the History
 * tab can both ask for a sync within the same second; the second caller
 * shares the first's promise rather than running the same log queries again
 * and racing it on the cursor.
 */
const inflight = new Map();

async function syncInboundTransfers(args) {
  const key = `${args.userId}:${args.chainId}`;
  if (inflight.has(key)) return inflight.get(key);
  const p = doSync(args).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

const EMPTY = { scanned: 0, added: 0, queries: 0, fromBlock: 0, discovered: 0, failed: false };

/**
 * Find and record inbound token transfers to `address` on one chain, and note
 * any token contract the wallet has not seen before.
 *
 * INCREMENTAL. The first sync for a wallet walks a bounded lookback; every later
 * one resumes from the stored cursor, so it reads only new blocks.
 *
 * @returns {Promise<{scanned:number, added:number, queries:number, fromBlock:number, discovered:number, failed:boolean}>}
 */
async function doSync({ userId, chainId, address }) {
  const chain = getChain(chainId);
  if (!chain || !address) return { ...EMPTY };

  const headHex = await rpc(chain, "eth_blockNumber", []);
  if (!headHex) return { ...EMPTY, failed: true };
  const head = parseInt(headHex, 16);
  if (!Number.isFinite(head)) return { ...EMPTY, failed: true };

  /**
   * Resume point, read from a STORED cursor rather than derived from the newest
   * recorded row. A wallet that has received nothing has no rows to derive from,
   * so a derived cursor would leave it re-walking the entire lookback on every
   * single History load — nine seconds, forever, for the most common case there
   * is.
   */
  const owner = await User.findById(userId)
    .select("walletHistoryCursors customTokens discoveredTokens")
    .lean();
  if (!owner) return { ...EMPTY };

  const saved = (owner.walletHistoryCursors || []).find((c) => c.chainId === chain.chainId);
  const span = spanFor(chain);

  // Everything this wallet already knows how to display, keyed by contract.
  const known = new Map();
  for (const t of tokensFor(chain)) known.set(String(t.address).toLowerCase(), { ...t, custom: false });
  for (const t of owner.customTokens || []) {
    if (t.chainId === chain.chainId) known.set(String(t.address).toLowerCase(), { ...t, custom: true });
  }
  const discovered = new Map();
  for (const d of owner.discoveredTokens || []) {
    if (d.chainId === chain.chainId) discovered.set(String(d.address).toLowerCase(), d);
  }

  // ---- plan the windows ----------------------------------------------------
  // First sync: newest first, a bounded number back from head. Resume: oldest
  // first from the cursor, so the cursor can be committed window by window.
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
  let queries = 0;
  let lowest = head;
  let failed = false;
  // Highest block known to have been read contiguously from the resume point.
  let readTo = saved ? saved.block : null;
  // Unknown contracts seen this sync: contract -> the earliest transfer.
  const unknown = new Map();

  for (const w of windows) {
    queries++;
    const logs = await rpc(chain, "eth_getLogs", [
      {
        topics: [TRANSFER_TOPIC, null, addressTopic(address)],
        fromBlock: "0x" + w.from.toString(16),
        toBlock: "0x" + w.to.toString(16),
      },
    ]);

    if (!Array.isArray(logs)) {
      /**
       * STOP, and say so. The old code `continue`d and then wrote the cursor
       * at head, which quietly declared these blocks read. A window that was
       * not read is not read; the cursor stays below it and the next load
       * tries again from here.
       */
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
      // ERC-20 Transfer has three topics (event, from, to). ERC-721 shares the
      // signature but indexes tokenId as a fourth topic; it is not a balance.
      if (!log || log.removed || !Array.isArray(log.topics) || log.topics.length !== 3) continue;
      const contract = String(log.address || "").toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(contract)) continue;

      const token = known.get(contract);
      if (token) {
        added += await recordTransfer({ userId, chain, address, log, symbol: token.symbol, decimals: token.decimals, contract });
        continue;
      }

      const seen = discovered.get(contract);
      if (seen) {
        // Already on the list. A token the owner ignored stays out of History
        // too; one still being decided on is recorded when it can be rendered.
        if (seen.status !== "ignored" && seen.readable && seen.decimals != null) {
          added += await recordTransfer({ userId, chain, address, log, symbol: seen.symbol, decimals: seen.decimals, contract });
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

  // ---- discovery ----------------------------------------------------------
  let discoveredCount = 0;
  let lookups = 0;

  // Retry contracts recorded earlier that would not answer, a few at a time.
  const retryable = [...discovered.values()].filter(
    (d) => !d.readable && d.status === "new" && (d.lookupAttempts || 0) < MAX_LOOKUP_ATTEMPTS
  );
  for (const d of retryable) {
    if (lookups >= MAX_LOOKUPS_PER_SYNC) break;
    lookups++;
    const meta = await readTokenMeta(chain, d.address);
    const set = {
      "discoveredTokens.$.lastLookupAt": new Date(),
      // A node that did not answer at all is not an attempt against the
      // contract; only an answer that was not a token counts toward the cap.
      "discoveredTokens.$.lookupAttempts": (d.lookupAttempts || 0) + (meta.transport ? 0 : 1),
    };
    if (meta.readable) {
      set["discoveredTokens.$.symbol"] = meta.symbol;
      set["discoveredTokens.$.name"] = meta.name;
      set["discoveredTokens.$.decimals"] = meta.decimals;
      set["discoveredTokens.$.readable"] = true;
      set["discoveredTokens.$.impersonates"] = impersonationOf(meta.symbol, chain);
    } else if (meta.symbol || meta.name) {
      // Partial answers are still worth showing while the rest is retried.
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
      // Guarded push: a concurrent sync on another device cannot record the
      // same contract twice, because the filter refuses a user document that
      // already carries it.
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
          added += await recordTransfer({ userId, chain, address, log, symbol: meta.symbol, decimals: meta.decimals, contract });
        }
      }
    } catch (err) {
      console.error("[walletHistory] discovery insert failed:", err.message);
    }
  }

  // ---- commit the cursor ---------------------------------------------------
  // "I have read up to here" is the useful fact, not "I found something here",
  // and it is only true for blocks that were actually read.
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
      // A cursor that fails to save only costs a repeated scan next time.
      console.error("[walletHistory] cursor save failed:", err.message);
    }
  }

  return { scanned, added, queries, fromBlock: lowest, discovered: discoveredCount, failed };
}

function safeUnits(dataHex, decimals) {
  try {
    return unitsToDecimalString(BigInt(dataHex || "0x0"), decimals);
  } catch {
    return null;
  }
}

/** Upsert one inbound transfer as a WalletTx row. Returns 1 if a row was added. */
async function recordTransfer({ userId, chain, address, log, symbol, decimals, contract }) {
  try {
    // Already-known transactions (including ones the app sent itself) are
    // left exactly as they are.
    const existing = await WalletTx.findOne({ hash: log.transactionHash }).select("_id").lean();
    if (existing) return 0;

    const value = safeUnits(log.data, decimals);
    if (value == null) return 0;

    await WalletTx.create({
      userId,
      chainId: chain.chainId,
      hash: log.transactionHash,
      from: "0x" + String(log.topics[1] || "").slice(-40),
      to: address,
      value,
      symbol,
      tokenAddress: contract,
      direction: "in",
      // Received, so it is already on chain and already final enough to show.
      // The reconciliation loop leaves confirmed rows alone.
      status: "confirmed",
      kind: "transfer",
      blockNumber: parseInt(log.blockNumber, 16),
    });
    return 1;
  } catch (err) {
    // A concurrent sync inserting the same hash is fine — the unique index is
    // doing its job.
    if (err.code !== 11000) console.error("[walletHistory] insert failed:", err.message);
    return 0;
  }
}

module.exports = {
  syncInboundTransfers,
  // Exported for tests and for the discovery endpoint's metadata retry.
  readTokenMeta,
  decodeAbiString,
  sanitizeText,
  spanFor,
  MAX_DISCOVERED_PER_CHAIN,
  MAX_LOOKUP_ATTEMPTS,
};
