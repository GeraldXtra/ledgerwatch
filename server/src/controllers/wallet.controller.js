const User = require("../models/User");
const WalletTx = require("../models/WalletTx");
const { listChains, getChain } = require("../config/chains");
const { sendToChain } = require("../services/rpc.service");

// Strict allowlist: read methods + raw-tx broadcast + receipt polling. Notably it
// does NOT (and cannot) include any signing method — the server never holds a key.
// Anything not on this list is rejected before it ever reaches the upstream RPC.
const ALLOWED_METHODS = new Set([
  "eth_chainId",
  "net_version",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getCode",
  "eth_getTransactionCount",
  "eth_getBlockByNumber",
  "eth_sendRawTransaction",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
]);

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

// GET /api/wallet/chains  -> enabled chains (rpc stripped) + mainnet flag.
async function chains(req, res) {
  return res.json({
    chains: listChains(),
    enableMainnet: process.env.ENABLE_MAINNET === "true",
  });
}

// POST /api/wallet/rpc/:chainId  -> JSON-RPC proxy with a strict method allowlist.
// Body is a standard JSON-RPC request (single object or a batch array), so the
// client can point ethers.JsonRpcProvider straight at this URL. The upstream RPC
// URL (which may carry the Alchemy key) never reaches the browser.
const MAX_BATCH = 24;

async function rpc(req, res) {
  try {
    const chain = getChain(req.params.chainId);
    if (!chain) return res.status(400).json({ error: "Unknown or disabled chain" });

    const body = req.body;
    const items = Array.isArray(body) ? body : [body];
    if (items.length === 0) return res.status(400).json({ error: "Empty request" });

    /**
     * BOUNDED. The only ceiling on a batch used to be the global 3 MB body
     * limit, which is roughly fifty thousand calls in one request against the
     * operator's upstream key, from any registered account, occupying a single
     * concurrency slot. ethers is configured with batchMaxCount 1 on this
     * client, so anything past a couple of dozen is not a wallet talking.
     */
    if (items.length > MAX_BATCH) {
      return res.status(413).json({ error: `At most ${MAX_BATCH} calls per request` });
    }

    for (const item of items) {
      if (!item || typeof item.method !== "string" || !ALLOWED_METHODS.has(item.method)) {
        return res.status(403).json({
          error: `Method not allowed: ${item && item.method}`,
        });
      }
    }

    // Walks the chain's verified endpoint list, with a timeout, and forwards the
    // first real answer. See rpc.service.js for what does and does not warrant
    // trying the next endpoint — notably, a JSON-RPC error inside a 200 is the
    // chain's genuine answer and is forwarded untouched.
    const upstream = await sendToChain(chain, body);

    if (!upstream.ok) {
      /**
       * Report WHY. The previous version logged `err.message`, which for any
       * undici transport failure is the fixed string "fetch failed" — the same
       * five characters whether DNS failed, the host refused the connection, TLS
       * broke or the request timed out. That message could not distinguish the
       * two real causes here (Alchemy returning 403 for networks not enabled on
       * the app, and a dead public endpoint), so it named neither.
       *
       * Hosts only, never URLs: the Alchemy key lives in the path.
       */
      const detail = upstream.attempts.map((a) => `${a.host} -> ${a.reason}`).join(" | ");
      console.error(
        `wallet rpc proxy: ${chain.name} failed on all ${upstream.total} endpoint(s): ${detail}`
      );

      const first = upstream.attempts[0] || {};
      return res.status(502).json({
        error: "RPC upstream failed",
        // Surfaced so the wallet can say "Base Sepolia RPC unreachable (403)"
        // rather than showing an empty balance with no explanation.
        chain: chain.name,
        reason: first.reason || "unknown",
        code: first.code || null,
        endpointsTried: upstream.total,
      });
    }

    res.status(upstream.status);
    res.set("Content-Type", "application/json");
    return res.send(upstream.text);
  } catch (err) {
    // Anything not already handled above — a bug here, not an upstream fault.
    console.error("wallet rpc proxy error:", err.message, err.cause ? `cause=${err.cause.code || err.cause.message}` : "");
    return res.status(502).json({ error: "RPC upstream failed", reason: err.message });
  }
}

// POST /api/wallet/address  { address }  -> persist the PUBLIC address only.
async function setAddress(req, res) {
  try {
    const address = (req.body && req.body.address) || "";
    if (!ADDRESS_RE.test(address)) {
      return res.status(400).json({ error: "Invalid address" });
    }
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { walletAddress: address },
      { new: true }
    ).select("-passwordHash");
    return res.json({ walletAddress: user.walletAddress });
  } catch (err) {
    console.error("wallet setAddress error:", err.message);
    return res.status(500).json({ error: "Failed to save address" });
  }
}

// DELETE /api/wallet/address -> forget the public address (client also clears the
// encrypted keystore from its own localStorage).
async function clearAddress(req, res) {
  try {
    await User.findByIdAndUpdate(req.user._id, { walletAddress: null });
    return res.json({ ok: true });
  } catch (err) {
    console.error("wallet clearAddress error:", err.message);
    return res.status(500).json({ error: "Failed to clear address" });
  }
}

// GET /api/wallet/txs?chainId=  -> locally recorded history, newest first.
async function listTxs(req, res) {
  try {
    const query = { userId: req.user._id };
    if (req.query.chainId) query.chainId = Number(req.query.chainId);

    /**
     * Pick up anything that ARRIVED without the app sending it, before listing.
     * Without this, History only ever showed outgoing transactions the app
     * itself initiated, so a wallet that had genuinely received funds looked
     * empty. Never throws: a failed sync should still return the known rows.
     */
    if (req.query.chainId && req.user.walletAddress) {
      const { syncInboundTransfers } = require("../services/walletHistory.service");
      await syncInboundTransfers({
        userId: req.user._id,
        chainId: Number(req.query.chainId),
        address: req.user.walletAddress,
      }).catch((err) => console.error("[wallet] inbound sync failed:", err.message));
    }

    const txs = await WalletTx.find(query).sort({ createdAt: -1 }).limit(100);
    return res.json({ txs });
  } catch (err) {
    console.error("wallet listTxs error:", err.message);
    return res.status(500).json({ error: "Failed to load history" });
  }
}

// POST /api/wallet/txs  -> record a broadcast tx (public data only).
async function recordTx(req, res) {
  try {
    const {
      chainId, hash, from, to, value, symbol, tokenAddress, direction,
      kind, tokenOut, tokenOutSymbol, amountOut, minAmountOut, feeTier,
      priceImpactPct, side, alertId,
    } = req.body || {};
    if (!getChain(chainId)) return res.status(400).json({ error: "Unknown or disabled chain" });
    if (!HASH_RE.test(hash || "")) return res.status(400).json({ error: "Invalid tx hash" });
    if (!ADDRESS_RE.test(from || "") || !ADDRESS_RE.test(to || "")) {
      return res.status(400).json({ error: "Invalid address" });
    }
    if (tokenOut && !ADDRESS_RE.test(tokenOut)) {
      return res.status(400).json({ error: "Invalid output token address" });
    }

    const tx = await WalletTx.create({
      userId: req.user._id,
      chainId: Number(chainId),
      hash,
      from,
      to,
      value: value != null ? String(value) : "0",
      symbol: symbol || "ETH",
      tokenAddress: tokenAddress || null,
      direction: direction === "in" ? "in" : "out",
      status: "pending",
      // Swap metadata. Absent for ordinary transfers, which keep behaving exactly
      // as before.
      kind: ["swap", "approval"].includes(kind) ? kind : "transfer",
      tokenOut: tokenOut || null,
      tokenOutSymbol: tokenOutSymbol || null,
      amountOut: amountOut != null ? String(amountOut) : null,
      minAmountOut: minAmountOut != null ? String(minAmountOut) : null,
      feeTier: feeTier != null ? Number(feeTier) : null,
      priceImpactPct: priceImpactPct != null ? Number(priceImpactPct) : null,
      side: ["buy", "sell"].includes(side) ? side : null,
      alertId: alertId || null,
    });
    return res.status(201).json({ tx });
  } catch (err) {
    // The unique index on `hash` makes a repeat harmless rather than a duplicate
    // row: return the existing record so the caller carries on normally.
    if (err.code === 11000) {
      const existing = await WalletTx.findOne({ hash: req.body.hash, userId: req.user._id });
      if (existing) return res.status(200).json({ tx: existing });
      return res.status(409).json({ error: "That transaction is already recorded." });
    }
    console.error("wallet recordTx error:", err.message);
    return res.status(500).json({ error: "Failed to record transaction" });
  }
}

// PATCH /api/wallet/txs/:id  { status } -> update a recorded tx's status.
async function updateTxStatus(req, res) {
  try {
    const status = req.body && req.body.status;
    if (!["pending", "confirmed", "failed"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const tx = await WalletTx.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { status },
      { new: true }
    );
    if (!tx) return res.status(404).json({ error: "Transaction not found" });
    return res.json({ tx });
  } catch (err) {
    console.error("wallet updateTxStatus error:", err.message);
    return res.status(500).json({ error: "Failed to update transaction" });
  }
}

/**
 * GET /api/wallet/spend  -> { spent24h, currency: "USD", swaps }
 *
 * The dollar value of every live swap this account signed in the last twenty
 * four hours, across every chain. This is the figure the daily trading cap is
 * measured against. It used to be hardcoded to zero on the client, which made
 * the daily cap arithmetic reduce to the per trade cap and the daily limit
 * did not exist. A per session counter in browser memory reset on reload, so
 * it did not exist either.
 *
 * Counted from WalletTx, which every swap writes on broadcast, so a reload, a
 * second tab or a second device all see the same number. The cash leg is the
 * input on a buy and the output on a sell; whichever side the dollar is on.
 */
const CASH_RE = /^(USDC|USDT|USD₮0|USDT0|USDt)$/i;

async function spend24h(req, res) {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await WalletTx.find({
      userId: req.user._id,
      kind: "swap",
      status: { $ne: "failed" },
      createdAt: { $gte: since },
    })
      .select("side symbol value tokenOutSymbol amountOut")
      .lean();

    let spent = 0;
    for (const t of rows) {
      if (t.side === "buy" && CASH_RE.test(t.symbol || "")) spent += Number(t.value) || 0;
      else if (t.side === "sell" && CASH_RE.test(t.tokenOutSymbol || "")) spent += Number(t.amountOut) || 0;
    }
    return res.json({ spent24h: Number(spent.toFixed(2)), currency: "USD", swaps: rows.length });
  } catch (err) {
    console.error("wallet spend24h error:", err.message);
    return res.status(500).json({ error: "Could not compute recent spend" });
  }
}

/**
 * Discovered tokens for one chain, shaped for the wallet. The address is
 * stored lowercase for matching; the explorer link is built here so the
 * client never has to know an explorer URL.
 */
function shapeDiscovered(list, chain) {
  return (list || [])
    .filter((d) => d.chainId === chain.chainId)
    .map((d) => ({
      chainId: d.chainId,
      address: d.address,
      symbol: d.symbol,
      name: d.name,
      decimals: d.decimals,
      readable: Boolean(d.readable),
      lookupAttempts: d.lookupAttempts || 0,
      impersonates: d.impersonates || null,
      firstSeenAt: d.firstSeenAt,
      firstSeenBlock: d.firstSeenBlock,
      firstTxHash: d.firstTxHash,
      firstFrom: d.firstFrom,
      firstAmount: d.firstAmount,
      status: d.status,
      explorer: chain.explorer ? `${chain.explorer}/token/${d.address}` : null,
      explorerTx: chain.explorer && d.firstTxHash ? `${chain.explorer}/tx/${d.firstTxHash}` : null,
    }))
    .sort((a, b) => new Date(b.firstSeenAt) - new Date(a.firstSeenAt));
}

/**
 * GET /api/wallet/discovered?chainId=  -> { tokens, sync }
 *
 * Runs the inbound scan first, so opening the wallet is what notices a token
 * that arrived while it was closed. The scan never throws; when it fails the
 * known list is still returned and `sync.failed` says so, because "nothing
 * new" and "could not look" are different facts and the wallet shows them
 * differently.
 */
async function discovered(req, res) {
  try {
    const chain = getChain(req.query.chainId);
    if (!chain) return res.status(400).json({ error: "Unknown or disabled chain" });

    let sync = { failed: false, skipped: true };
    if (req.user.walletAddress) {
      const { syncInboundTransfers } = require("../services/walletHistory.service");
      sync = await syncInboundTransfers({
        userId: req.user._id,
        chainId: chain.chainId,
        address: req.user.walletAddress,
      }).catch((err) => {
        console.error("[wallet] discovery sync failed:", err.message);
        return { failed: true };
      });
    }

    const user = await User.findById(req.user._id).select("discoveredTokens").lean();
    return res.json({ tokens: shapeDiscovered(user && user.discoveredTokens, chain), sync });
  } catch (err) {
    console.error("wallet discovered error:", err.message);
    return res.status(500).json({ error: "Could not check for new tokens" });
  }
}

/**
 * POST /api/wallet/discovered/:chainId/:address  { action: add | ignore | restore }
 *
 * The owner's decision about a token that arrived uninvited. `add` puts it in
 * the custom token list with the decimals READ FROM ITS CONTRACT, which is the
 * only reason a token that could not be read is refused here: a balance shown
 * with guessed decimals is a wrong number, and this wallet does not show
 * those. `ignore` keeps it off every list until `restore`.
 */
async function discoveredAct(req, res) {
  try {
    const chain = getChain(req.params.chainId);
    if (!chain) return res.status(400).json({ error: "Unknown or disabled chain" });
    const address = String(req.params.address || "").toLowerCase();
    if (!ADDRESS_RE.test(address)) return res.status(400).json({ error: "Invalid contract address" });
    const action = req.body && req.body.action;
    if (!["add", "ignore", "restore"].includes(action)) {
      return res.status(400).json({ error: "Action must be add, ignore or restore" });
    }

    const user = await User.findById(req.user._id).select("discoveredTokens customTokens");
    if (!user) return res.status(404).json({ error: "Account not found" });
    const entry = (user.discoveredTokens || []).find(
      (d) => d.chainId === chain.chainId && d.address === address
    );
    if (!entry) return res.status(404).json({ error: "That token is not on your discovered list" });

    if (action === "add") {
      if (!entry.readable || entry.decimals == null || !entry.symbol) {
        return res.status(409).json({
          error:
            "This contract could not be read as a standard token, so its balance cannot be shown correctly. It can be ignored, or added by hand once you have checked it on the explorer.",
        });
      }
      const d = Number(entry.decimals);
      if (!Number.isInteger(d) || d < 0 || d > 36) {
        return res.status(409).json({ error: "This token reports decimals outside the supported range" });
      }
      const exists = (user.customTokens || []).some(
        (t) => t.chainId === chain.chainId && String(t.address).toLowerCase() === address
      );
      if (!exists) {
        user.customTokens.push({
          chainId: chain.chainId,
          address,
          symbol: String(entry.symbol).slice(0, 24),
          decimals: d,
        });
      }
      entry.status = "added";
    } else if (action === "ignore") {
      entry.status = "ignored";
    } else {
      // restore: back to undecided. If it had been added, the custom token
      // stays; removing it is the existing remove-token action's job.
      entry.status = entry.status === "added" ? "added" : "new";
    }
    entry.decidedAt = new Date();
    await user.save();

    return res.json({
      tokens: shapeDiscovered(user.discoveredTokens, chain),
      customTokens: user.customTokens,
    });
  } catch (err) {
    console.error("wallet discoveredAct error:", err.message);
    return res.status(500).json({ error: "Could not update that token" });
  }
}

module.exports = {
  spend24h,
  chains,
  rpc,
  setAddress,
  clearAddress,
  listTxs,
  recordTx,
  updateTxStatus,
  discovered,
  discoveredAct,
};
