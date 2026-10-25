const { scopedRepo } = require("../repositories/scoped");
const { decimalToUnits } = require("../domain/money");
const { listChains, getChain } = require("../config/chains");
const { confirmationsFor: recommendedConfirmations } = require("../config/derivation");
const { confirmationsFor } = require("../services/cryptoSettings.service");
const rpcService = require("../services/rpc.service");
const { sanitizeText } = require("../services/walletHistory.service");
const { limitsFor } = require("../config/tradingLimits");

const ALLOWED_METHODS = new Set([
  "eth_chainId",
  "net_version",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_call",
  "eth_simulateV1",
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
const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

function defaultChainId() {
  const mainnet = process.env.ENABLE_MAINNET === "true";
  const preferred = mainnet ? 8453 : 84532;
  if (getChain(preferred)) return preferred;
  const list = listChains();
  const first = list.find((c) => (mainnet ? !c.testnet : c.testnet)) || list[0];
  return first ? first.chainId : null;
}

async function chains(req, res) {
  return res.json({
    chains: listChains().map((chain) => ({
      ...chain,
      recommendedConfirmations: recommendedConfirmations(chain.chainId),
      confirmations: confirmationsFor(chain.chainId, req.user),
    })),
    enableMainnet: process.env.ENABLE_MAINNET === "true",
    defaultChainId: defaultChainId(),
  });
}

const MAX_BATCH = 24;

function isBroadcastBody(body) {
  const items = Array.isArray(body) ? body : [body];
  return items.some((item) => item && item.method === "eth_sendRawTransaction");
}

async function rpc(req, res) {
  const broadcast = isBroadcastBody(req.body);
  try {
    const chain = getChain(req.params.chainId);
    if (!chain) return res.status(400).json({ error: "Unknown or disabled chain" });

    const body = req.body;
    const items = Array.isArray(body) ? body : [body];
    if (items.length === 0) return res.status(400).json({ error: "Empty request" });

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

    const upstream = await rpcService.sendToChain(chain, body);

    if (!upstream.ok) {
      const detail = upstream.attempts.map((a) => `${a.host} -> ${a.reason}`).join(" | ");
      console.error(
        `wallet rpc proxy: ${chain.name} failed on all ${upstream.total} endpoint(s): ${detail}`
      );

      const first = upstream.attempts[0] || {};
      return res.status(502).json({
        error: "RPC upstream failed",
        chain: chain.name,
        reason: first.reason || "unknown",
        code: first.code || null,
        endpointsTried: upstream.total,
        ...(broadcast ? { broadcast: upstream.ambiguous ? "unknown" : "not_sent" } : {}),
      });
    }

    res.status(upstream.status);
    res.set("Content-Type", "application/json");
    return res.send(upstream.text);
  } catch (err) {
    console.error("wallet rpc proxy error:", err.message, err.cause ? `cause=${err.cause.code || err.cause.message}` : "");
    return res.status(502).json({
      error: "RPC upstream failed",
      reason: err.message,
      ...(broadcast ? { broadcast: "unknown" } : {}),
    });
  }
}

async function setAddress(req, res) {
  try {
    const address = req.body.address || "";
    if (!ADDRESS_RE.test(address)) {
      return res.status(400).json({ error: "Invalid address" });
    }
    const user = await scopedRepo(req.user._id).self.update({ $set: { walletAddress: address } }).select("-passwordHash");
    return res.json({ walletAddress: user.walletAddress });
  } catch (err) {
    console.error("wallet setAddress error:", err.message);
    return res.status(500).json({ error: "Failed to save address" });
  }
}

async function clearAddress(req, res) {
  try {
    await scopedRepo(req.user._id).self.updateOne({ $set: { walletAddress: null } });
    return res.json({ ok: true });
  } catch (err) {
    console.error("wallet clearAddress error:", err.message);
    return res.status(500).json({ error: "Failed to clear address" });
  }
}

async function listTxs(req, res) {
  try {
    const query = {};
    if (req.query.chainId) query.chainId = Number(req.query.chainId);

    if (req.query.chainId && req.user.walletAddress) {
      const { syncInboundTransfers } = require("../services/walletHistory.service");
      await syncInboundTransfers({
        userId: req.user._id,
        chainId: Number(req.query.chainId),
        address: req.user.walletAddress,
      }).catch((err) => console.error("[wallet] inbound sync failed:", err.message));
    }

    const txs = await scopedRepo(req.user._id).walletTxs.find(query).sort({ createdAt: -1 }).limit(100);
    return res.json({ txs });
  } catch (err) {
    console.error("wallet listTxs error:", err.message);
    return res.status(500).json({ error: "Failed to load history" });
  }
}

async function recordTx(req, res) {
  try {
    const {
      chainId, hash, from, to, value, symbol, tokenAddress, direction,
      kind, tokenOut, tokenOutSymbol, amountOut, minAmountOut, feeTier,
      priceImpactPct, side, alertId, route, profitId,
    } = req.body;
    const repo = scopedRepo(req.user._id);
    if (!getChain(chainId)) return res.status(400).json({ error: "Unknown or disabled chain" });
    if (!HASH_RE.test(hash || "")) return res.status(400).json({ error: "Invalid tx hash" });
    if (!ADDRESS_RE.test(from || "") || !ADDRESS_RE.test(to || "")) {
      return res.status(400).json({ error: "Invalid address" });
    }
    if (tokenOut && !ADDRESS_RE.test(tokenOut)) {
      return res.status(400).json({ error: "Invalid output token address" });
    }
    if (tokenAddress && !ADDRESS_RE.test(tokenAddress)) {
      return res.status(400).json({ error: "Invalid token address" });
    }
    const AMOUNT_RE = /^\d{1,60}(\.\d{1,36})?$/;
    for (const [label, v] of [["value", value], ["amountOut", amountOut], ["minAmountOut", minAmountOut]]) {
      if (v != null && !AMOUNT_RE.test(String(v))) {
        return res.status(400).json({ error: `Invalid ${label}` });
      }
    }
    if ((symbol && String(symbol).length > 24) || (tokenOutSymbol && String(tokenOutSymbol).length > 24)) {
      return res.status(400).json({ error: "Invalid token symbol" });
    }

    const existing = await repo.walletTxs.findOne({ hash });
    if (existing) return res.status(200).json({ tx: existing });

    let profitRow = null;
    if (profitId != null) {
      if (!OBJECT_ID_RE.test(String(profitId))) return res.status(400).json({ error: "Invalid profit record" });
      profitRow = await repo.profits.findOne({ _id: profitId, mode: "live" }).lean();
      if (!profitRow || !["pending", "moving"].includes(profitRow.status)) {
        return res.status(409).json({ error: "That profit has already been moved or set aside.", code: "profit_closed" });
      }
      const sameToken = String(tokenAddress || "").toLowerCase() === String(profitRow.cashAddress || "");
      const moved = value != null ? decimalToUnits(String(value), 36) : 0n;
      const withinProfit = moved > 0n && profitRow.profitAmount != null && moved <= decimalToUnits(String(profitRow.profitAmount), 36);
      if (kind === "swap" || kind === "approval" || direction === "in" || Number(chainId) !== profitRow.chainId || !sameToken || !withinProfit) {
        return res.status(400).json({
          error: `A profit move must send at most ${profitRow.profitAmount} ${profitRow.cashSymbol} on the chain where the profit was made.`,
          code: "profit_mismatch",
        });
      }
    }

    if (kind === "swap") {
      const verdict = await checkSwapLimits({
        user: req.user,
        chain: getChain(chainId),
        side,
        symbol,
        value,
        tokenOutSymbol,
        amountOut,
      });
      if (!verdict.ok) return res.status(409).json({ error: verdict.error, code: verdict.code });
    }

    const tx = await repo.walletTxs.create({
      profitId: profitRow ? profitRow._id : null,
      chainId: Number(chainId),
      hash,
      from,
      to,
      value: value != null ? String(value) : "0",
      symbol: symbol || "ETH",
      tokenAddress: tokenAddress || null,
      direction: direction === "in" ? "in" : "out",
      status: "pending",
      kind: ["swap", "approval"].includes(kind) ? kind : "transfer",
      tokenOut: tokenOut || null,
      tokenOutSymbol: tokenOutSymbol || null,
      amountOut: amountOut != null ? String(amountOut) : null,
      minAmountOut: minAmountOut != null ? String(minAmountOut) : null,
      feeTier: feeTier != null ? Number(feeTier) : null,
      route: sanitizeText(route, 120),
      priceImpactPct: priceImpactPct != null ? Number(priceImpactPct) : null,
      side: ["buy", "sell"].includes(side) ? side : null,
      alertId: alertId || null,
    });
    if (profitRow) {
      await require("../services/profit.service")
        .markMoving(req.user._id, profitRow._id, { txId: tx._id, txHash: tx.hash, profitAddress: to })
        .catch((err) => console.error("wallet recordTx profit link:", err.message));
    }
    return res.status(201).json({ tx });
  } catch (err) {
    if (err.code === 11000) {
      const existing = await scopedRepo(req.user._id).walletTxs.findOne({ hash: req.body.hash });
      if (existing) return res.status(200).json({ tx: existing });
      return res.status(409).json({ error: "That transaction is already recorded." });
    }
    console.error("wallet recordTx error:", err.message);
    return res.status(500).json({ error: "Failed to record transaction" });
  }
}

function announceLater(tx) {
  if (!tx || !["confirmed", "failed"].includes(tx.status)) return;
  require("../services/walletActivity.service")
    .announceWalletTx(tx._id)
    .catch((err) => console.error("[wallet] announce failed:", err.message));
}

const MAX_CHAIN_ADDRESSES = 30;

async function listChainAddresses(req, res) {
  const user = await scopedRepo(req.user._id).self.get("chainAddresses").lean();
  return res.json({
    addresses: ((user && user.chainAddresses) || []).map(({ chain, network, address, addedAt }) => ({ chain, network, address, addedAt })),
  });
}

async function setChainAddress(req, res) {
  try {
    const { chain, network, address } = req.body;
    const { validateChainAddress } = require("../config/chainAddresses");
    const v = validateChainAddress(chain, network, address);
    if (!v.ok) return res.status(400).json({ error: v.reason });
    const self = scopedRepo(req.user._id).self;
    await self.updateOne({ $pull: { chainAddresses: { chain: v.chain, network: v.network } } });
    const r = await self.updateWhere(
      { [`chainAddresses.${MAX_CHAIN_ADDRESSES - 1}`]: { $exists: false } },
      { $push: { chainAddresses: { chain: v.chain, network: v.network, address: v.address, addedAt: new Date() } } }
    );
    if (!r.modifiedCount) return res.status(409).json({ error: "Too many addresses are registered on this account." });
    return res.status(201).json({ ok: true, chain: v.chain, network: v.network, address: v.address });
  } catch (err) {
    console.error("wallet setChainAddress error:", err.message);
    return res.status(500).json({ error: "Failed to save that address" });
  }
}

async function updateTxStatus(req, res) {
  try {
    const status = req.body.status;
    if (!["pending", "confirmed", "failed"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const tx = await scopedRepo(req.user._id).walletTxs.findById(req.params.id);
    if (!tx) return res.status(404).json({ error: "Transaction not found" });

    if (tx.kind === "swap" && status === "failed" && tx.status !== "failed") {
      const chain = getChain(tx.chainId);
      if (!chain) return res.status(400).json({ error: "Unknown or disabled chain" });

      const unverified = (reason) => {
        console.warn(`[wallet] could not verify swap ${tx.hash} on ${chain.name}: ${reason}`);
        return res.status(503).json({
          error:
            `${chain.name} could not be reached to confirm that this swap failed, so nothing was ` +
            `changed. It still counts towards your daily limit until the chain says otherwise.`,
          code: "unverified",
        });
      };

      const read = await rpcService.rpcCallTyped(chain, "eth_getTransactionReceipt", [tx.hash]);
      if (!read.ok) return unverified(read.reason);
      const receipt = read.result;
      if (receipt && receipt.status === "0x1") {
        tx.status = "confirmed";
        await tx.save();
        announceLater(tx);
        return res.status(409).json({
          tx,
          error: "That swap succeeded on chain, so it has been recorded as confirmed.",
        });
      }
      if (!receipt) {
        const seen = await rpcService.rpcCallTyped(chain, "eth_getTransactionByHash", [tx.hash]);
        if (!seen.ok) return unverified(seen.reason);
        if (seen.result) {
          return res.status(409).json({
            tx,
            error:
              "That swap has not been mined yet, so it cannot be recorded as failed. It still " +
              "counts towards your daily limit until the chain reports it.",
            code: "not_mined",
          });
        }
        tx.status = "failed";
        await tx.save();
        announceLater(tx);
        return res.json({ tx, notOnChain: true });
      }
    }

    tx.status = status;
    await tx.save();
    announceLater(tx);
    return res.json({ tx });
  } catch (err) {
    console.error("wallet updateTxStatus error:", err.message);
    return res.status(500).json({ error: "Failed to update transaction" });
  }
}

const CASH_RE = /^(USDC|USDT|USD₮0|USDT0|USDt)$/i;

function swapCashValue({ side, symbol, value, tokenOutSymbol, amountOut }) {
  if (side === "buy" && CASH_RE.test(symbol || "")) return Number(value) || 0;
  if (side === "sell" && CASH_RE.test(tokenOutSymbol || "")) return Number(amountOut) || 0;
  return null;
}

async function spentInLast24h(userId) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await scopedRepo(userId).walletTxs.find({
    kind: "swap",
    status: { $ne: "failed" },
    createdAt: { $gte: since },
  })
    .select("side symbol value tokenOutSymbol amountOut")
    .lean();

  let spent = 0;
  let unpriced = 0;
  for (const t of rows) {
    const cash = swapCashValue(t);
    if (cash == null) unpriced += 1;
    else spent += cash;
  }
  return { spent, unpriced, swaps: rows.length };
}

async function checkSwapLimits({ user, chain, side, symbol, value, tokenOutSymbol, amountOut }) {
  const cash = swapCashValue({ side, symbol, value, tokenOutSymbol, amountOut });
  if (cash == null) {
    return {
      ok: false,
      code: "unpriced_swap",
      error:
        "This swap could not be valued in dollars, so it cannot be checked against your daily live " +
        "trading limit. It was not recorded and should not be sent.",
    };
  }
  const limits = limitsFor(chain, user && user.tradingLimits);
  if (cash > limits.perTrade) {
    return {
      ok: false,
      code: "trade_limit",
      error: `This swap is worth about $${cash.toFixed(2)}, above your $${limits.perTrade} limit for one live trade.`,
    };
  }
  const { spent } = await spentInLast24h(user._id);
  if (spent + cash > limits.perDay) {
    const left = Math.max(0, limits.perDay - spent);
    return {
      ok: false,
      code: "daily_limit",
      error:
        `This swap would take your live trading in the last 24 hours to $${(spent + cash).toFixed(2)}, ` +
        `above your $${limits.perDay} daily limit. $${left.toFixed(2)} is left today.`,
    };
  }
  return { ok: true, cash, spent, limits };
}

async function spend24h(req, res) {
  try {
    const { spent, unpriced, swaps } = await spentInLast24h(req.user._id);
    return res.json({
      spent24h: Number(spent.toFixed(2)),
      currency: "USD",
      swaps,
      unpricedSwaps: unpriced,
      complete: unpriced === 0,
    });
  } catch (err) {
    console.error("wallet spend24h error:", err.message);
    return res.status(500).json({ error: "Could not compute recent spend" });
  }
}

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

    const user = await scopedRepo(req.user._id).self.get("discoveredTokens").lean();
    return res.json({ tokens: shapeDiscovered(user && user.discoveredTokens, chain), sync });
  } catch (err) {
    console.error("wallet discovered error:", err.message);
    return res.status(500).json({ error: "Could not check for new tokens" });
  }
}

async function discoveredAct(req, res) {
  try {
    const chain = getChain(req.params.chainId);
    if (!chain) return res.status(400).json({ error: "Unknown or disabled chain" });
    const address = String(req.params.address || "").toLowerCase();
    if (!ADDRESS_RE.test(address)) return res.status(400).json({ error: "Invalid contract address" });
    const action = req.body.action;
    if (!["add", "ignore", "restore"].includes(action)) {
      return res.status(400).json({ error: "Action must be add, ignore or restore" });
    }

    const user = await scopedRepo(req.user._id).self.get("discoveredTokens customTokens");
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
  ALLOWED_METHODS,
  defaultChainId,
  checkSwapLimits,
  spentInLast24h,
  spend24h,
  chains,
  rpc,
  setAddress,
  clearAddress,
  listTxs,
  recordTx,
  updateTxStatus,
  listChainAddresses,
  setChainAddress,
  discovered,
  discoveredAct,
};
