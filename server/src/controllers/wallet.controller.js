const User = require("../models/User");
const WalletTx = require("../models/WalletTx");
const { listChains, getChain } = require("../config/chains");

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
async function rpc(req, res) {
  try {
    const chain = getChain(req.params.chainId);
    if (!chain) return res.status(400).json({ error: "Unknown or disabled chain" });

    const body = req.body;
    const items = Array.isArray(body) ? body : [body];
    if (items.length === 0) return res.status(400).json({ error: "Empty request" });

    for (const item of items) {
      if (!item || typeof item.method !== "string" || !ALLOWED_METHODS.has(item.method)) {
        return res.status(403).json({
          error: `Method not allowed: ${item && item.method}`,
        });
      }
    }

    const upstream = await fetch(chain.rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.set("Content-Type", "application/json");
    return res.send(text);
  } catch (err) {
    console.error("wallet rpc proxy error:", err.message);
    return res.status(502).json({ error: "RPC upstream failed" });
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
    const { chainId, hash, from, to, value, symbol, tokenAddress, direction } = req.body || {};
    if (!getChain(chainId)) return res.status(400).json({ error: "Unknown or disabled chain" });
    if (!HASH_RE.test(hash || "")) return res.status(400).json({ error: "Invalid tx hash" });
    if (!ADDRESS_RE.test(from || "") || !ADDRESS_RE.test(to || "")) {
      return res.status(400).json({ error: "Invalid address" });
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
    });
    return res.status(201).json({ tx });
  } catch (err) {
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

module.exports = {
  chains,
  rpc,
  setAddress,
  clearAddress,
  listTxs,
  recordTx,
  updateTxStatus,
};
