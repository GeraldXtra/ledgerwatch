const User = require("../models/User");
const publicUser = require("../utils/publicUser");
const { getChain } = require("../config/chains");

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * The shared demo account can never trade live.
 *
 * ENFORCED HERE, ON THE SERVER, not by hiding a toggle. Anyone can call this
 * endpoint directly, and the demo credentials are published in the README — so
 * the UI hiding the control is defence in depth, and this is the actual control.
 */
const PROTECTED_EMAIL = "demo@ledgerwatch.app";

function isDemo(user) {
  return String(user.email || "").toLowerCase() === PROTECTED_EMAIL;
}

/**
 * Temporary unlock for a SUPERVISED demonstration.
 *
 * Off unless explicitly set. The credentials for this account are printed in the
 * README, so with the flag on, anyone who signs in can put the shared account
 * into live mode. That is acceptable while someone is presenting and watching;
 * it is not acceptable as a standing configuration, which is why it defaults to
 * false rather than being removed.
 *
 * Note the blast radius is bounded by design: the keystore lives in the
 * presenter's own browser, so another visitor switching the shared account to
 * live mode still has no key to sign with and cannot move anyone's funds.
 */
function demoLiveAllowed() {
  return process.env.DEMO_ALLOW_LIVE === "true";
}

/**
 * May this user trade live? The ONE place that answers it, so the API and the
 * UI can never disagree about the policy.
 */
function canTradeLive(user) {
  return !isDemo(user) || demoLiveAllowed();
}

/** Reused by the execution paths, so the lock cannot be bypassed by route. */
function assertCanTradeLive(user) {
  if (!canTradeLive(user)) {
    const err = new Error(
      "The shared demo account is limited to paper trading. Create your own account to trade live."
    );
    err.status = 403;
    throw err;
  }
}

// PATCH /api/trading/mode  { mode: "paper" | "live" }
async function setMode(req, res) {
  try {
    const mode = req.body && req.body.mode;
    if (!["paper", "live"].includes(mode)) {
      return res.status(400).json({ error: "mode must be 'paper' or 'live'" });
    }
    if (mode === "live") assertCanTradeLive(req.user);

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { tradingMode: mode },
      { new: true }
    ).select("-passwordHash");

    return res.json({ user: publicUser(user) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("setMode error:", err.message);
    return res.status(500).json({ error: "Failed to change trading mode" });
  }
}

// GET /api/trading/tokens?chainId=
async function listTokens(req, res) {
  try {
    const chainId = Number(req.query.chainId);
    const user = await User.findById(req.user._id).select("customTokens").lean();
    const custom = (user.customTokens || []).filter((t) => !chainId || t.chainId === chainId);
    return res.json({ tokens: custom });
  } catch (err) {
    console.error("listTokens error:", err.message);
    return res.status(500).json({ error: "Failed to load tokens" });
  }
}

// POST /api/trading/tokens  { chainId, address, symbol, decimals }
async function addToken(req, res) {
  try {
    const { chainId, address, symbol, decimals } = req.body || {};
    if (!getChain(chainId)) {
      return res.status(400).json({ error: "Unknown or disabled chain" });
    }
    if (!ADDRESS_RE.test(address || "")) {
      return res.status(400).json({ error: "Invalid contract address" });
    }
    // Decimals come from the contract on the client. Validated here anyway —
    // a bad value silently misreads every balance for that token.
    const d = Number(decimals);
    if (!Number.isInteger(d) || d < 0 || d > 36) {
      return res.status(400).json({ error: "Invalid token decimals" });
    }
    if (!symbol || String(symbol).length > 24) {
      return res.status(400).json({ error: "Invalid token symbol" });
    }

    const user = await User.findById(req.user._id).select("customTokens");
    const exists = (user.customTokens || []).some(
      (t) => t.chainId === Number(chainId) && t.address.toLowerCase() === address.toLowerCase()
    );
    if (!exists) {
      user.customTokens.push({
        chainId: Number(chainId),
        address,
        symbol: String(symbol),
        decimals: d,
      });
      await user.save();
    }
    return res.status(201).json({ tokens: user.customTokens });
  } catch (err) {
    console.error("addToken error:", err.message);
    return res.status(500).json({ error: "Failed to add token" });
  }
}

// DELETE /api/trading/tokens  { chainId, address }
async function removeToken(req, res) {
  try {
    const { chainId, address } = req.body || {};
    const user = await User.findById(req.user._id).select("customTokens");
    user.customTokens = (user.customTokens || []).filter(
      (t) =>
        !(t.chainId === Number(chainId) && t.address.toLowerCase() === String(address).toLowerCase())
    );
    await user.save();
    return res.json({ tokens: user.customTokens });
  } catch (err) {
    console.error("removeToken error:", err.message);
    return res.status(500).json({ error: "Failed to remove token" });
  }
}

module.exports = { setMode, listTokens, addToken, removeToken, assertCanTradeLive, isDemo, canTradeLive };
