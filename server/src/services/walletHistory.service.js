const WalletTx = require("../models/WalletTx");
const { getChain, tokensFor } = require("../config/chains");
const { rpcCall } = require("./rpc.service");

/**
 * INBOUND TRANSFER DISCOVERY.
 *
 * `WalletTx` rows have only ever come from `recordTx`, which the app calls when
 * IT sends something. So money arriving from anywhere else — a faucet, an
 * exchange, a client paying you — produced no record at all, and History looked
 * empty on a wallet that had genuinely received funds.
 *
 * This reads Transfer logs addressed TO the wallet and upserts them. The unique
 * index on `hash` makes it idempotent, so it can run on every load without
 * duplicating anything.
 *
 * Server-side because `eth_getLogs` is deliberately absent from the browser
 * facing RPC allowlist, exactly as the payment watcher does it.
 */

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * Must stay under the narrowest RPC range limit across the registry. Base
 * Sepolia's public node caps eth_getLogs at 2000 blocks and rejects anything
 * larger, which is what silently broke payment detection until it was measured.
 */
const MAX_BLOCK_SPAN = Number(process.env.WALLET_HISTORY_BLOCK_SPAN || 1500);

/**
 * Same per-chain span story as the payment watcher: the registry carries a
 * measured `logSpan` and a single global number is wrong across twelve chains.
 * See paymentWatch.service.js for the measurement and why a too-large span fails
 * silently rather than loudly.
 */
function spanFor(chain) {
  const override = Number(process.env.WALLET_HISTORY_BLOCK_SPAN);
  if (Number.isFinite(override) && override > 0) return override;
  const measured = Number(chain && chain.logSpan);
  return Number.isFinite(measured) && measured > 0 ? measured : MAX_BLOCK_SPAN;
}

// How far back a first-time scan reaches. Bounded on purpose: a full-history
// walk would be thousands of queries for a wallet that is usually days old.
const LOOKBACK_WINDOWS = Number(process.env.WALLET_HISTORY_WINDOWS || 4);

/**
 * Delegated to the shared rpc service: endpoint fallback and a request timeout,
 * decided in one place rather than re-implemented here. The previous local copy
 * logged `err.message`, which for a transport failure is always the bare string
 * "fetch failed" and names nothing.
 */
async function rpc(chain, method, params) {
  return rpcCall(chain, method, params);
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
 * Find and record inbound token transfers to `address` on one chain.
 *
 * INCREMENTAL. The first sync for a wallet walks a bounded lookback; every later
 * one resumes from the highest block already recorded, so it reads only new
 * blocks. Without that this ran a fixed 8 log queries on every History load, and
 * at roughly a second per query against a public RPC that is a seven second stall
 * on a screen that should open instantly.
 *
 * @returns {Promise<{scanned:number, added:number, queries:number, fromBlock:number}>}
 */
async function syncInboundTransfers({ userId, chainId, address }) {
  const chain = getChain(chainId);
  if (!chain || !address) return { scanned: 0, added: 0, queries: 0, fromBlock: 0 };

  const headHex = await rpc(chain, "eth_blockNumber", []);
  if (!headHex) return { scanned: 0, added: 0, queries: 0, fromBlock: 0 };
  const head = parseInt(headHex, 16);

  const tokens = tokensFor(chain);
  if (!tokens.length) return { scanned: 0, added: 0, queries: 0, fromBlock: 0 };

  /**
   * Resume point, read from a STORED cursor rather than derived from the newest
   * recorded row. A wallet that has received nothing has no rows to derive from,
   * so a derived cursor would leave it re-walking the entire lookback on every
   * single History load — nine seconds, forever, for the most common case there
   * is. The cursor advances whether or not anything was found.
   */
  const User = require("../models/User");
  const owner = await User.findById(userId).select("walletHistoryCursors").lean();
  const saved = (owner?.walletHistoryCursors || []).find((c) => c.chainId === chain.chainId);

  // A little overlap on resume, so a transfer mined at the boundary while the
  // previous sync was mid-flight cannot fall between the two runs.
  const resumeFrom = saved ? Math.max(0, saved.block - 50) : null;
  const span = spanFor(chain);
  const windows = resumeFrom === null ? LOOKBACK_WINDOWS : Math.max(1, Math.ceil((head - resumeFrom) / span));

  let added = 0;
  let scanned = 0;
  let queries = 0;
  let lowest = head;

  for (let w = 0; w < Math.min(windows, LOOKBACK_WINDOWS); w++) {
    const to = head - w * span;
    const from = Math.max(resumeFrom ?? 0, to - span + 1);
    if (to <= 0 || from > to) break;
    scanned++;
    lowest = Math.min(lowest, from);

    for (const token of tokens) {
      queries++;
      const logs = await rpc(chain, "eth_getLogs", [
        {
          address: token.address,
          topics: [TRANSFER_TOPIC, null, addressTopic(address)],
          fromBlock: "0x" + from.toString(16),
          toBlock: "0x" + to.toString(16),
        },
      ]);
      if (!Array.isArray(logs)) continue;

      for (const log of logs) {
        try {
          // Upsert on hash: already-known transactions (including ones the app
          // sent itself) are left exactly as they are.
          const existing = await WalletTx.findOne({ hash: log.transactionHash });
          if (existing) continue;

          await WalletTx.create({
            userId,
            chainId: chain.chainId,
            hash: log.transactionHash,
            from: "0x" + String(log.topics[1] || "").slice(-40),
            to: address,
            value: unitsToDecimalString(BigInt(log.data || "0x0"), token.decimals),
            symbol: token.symbol,
            tokenAddress: token.address,
            direction: "in",
            // Received, so it is already on chain and already final enough to
            // show. The reconciliation loop leaves confirmed rows alone.
            status: "confirmed",
            kind: "transfer",
            blockNumber: parseInt(log.blockNumber, 16),
          });
          added++;
        } catch (err) {
          // A concurrent sync inserting the same hash is fine — the unique index
          // is doing its job.
          if (err.code !== 11000) {
            console.error("[walletHistory] insert failed:", err.message);
          }
        }
      }
    }
  }

  // Advance the cursor even when nothing was found — "I have read up to here"
  // is the useful fact, not "I found something here".
  try {
    const User = require("../models/User");
    await User.updateOne(
      { _id: userId, "walletHistoryCursors.chainId": chain.chainId },
      { $set: { "walletHistoryCursors.$.block": head } }
    ).then(async (r) => {
      if (r.matchedCount === 0) {
        await User.updateOne(
          { _id: userId },
          { $push: { walletHistoryCursors: { chainId: chain.chainId, block: head } } }
        );
      }
    });
  } catch (err) {
    // A cursor that fails to save only costs a repeated scan next time.
    console.error("[walletHistory] cursor save failed:", err.message);
  }

  return { scanned, added, queries, fromBlock: lowest };
}

module.exports = { syncInboundTransfers };
