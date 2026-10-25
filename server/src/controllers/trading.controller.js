const { scopedRepo } = require("../repositories/scoped");
const publicUser = require("../utils/publicUser");
const { getChain, tokensFor } = require("../config/chains");
const { resolveCoinOnChain } = require("../services/tokenResolver.service");
const { readTokenMeta } = require("../services/walletHistory.service");

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const PROTECTED_EMAIL = "demo@ledgerwatch.app";

function isDemo(user) {
  return String(user.email || "").toLowerCase() === PROTECTED_EMAIL;
}

function assertCanTradeLive(user) {
  if (isDemo(user)) {
    const err = new Error(
      "The shared demo account is limited to paper trading. Create your own account to trade live."
    );
    err.status = 403;
    throw err;
  }
}

async function setMode(req, res) {
  try {
    const mode = req.body.mode;
    if (!["paper", "live"].includes(mode)) {
      return res.status(400).json({ error: "mode must be 'paper' or 'live'" });
    }
    if (mode === "live") assertCanTradeLive(req.user);

    const user = await scopedRepo(req.user._id).self.update({ $set: { tradingMode: mode } }).select("-passwordHash");

    return res.json({ user: publicUser(user) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("setMode error:", err.message);
    return res.status(500).json({ error: "Failed to change trading mode" });
  }
}

async function listTokens(req, res) {
  try {
    const chainId = Number(req.query.chainId);
    const user = await scopedRepo(req.user._id).self.get("customTokens").lean();
    const custom = (user.customTokens || []).filter((t) => !chainId || t.chainId === chainId);
    return res.json({ tokens: custom });
  } catch (err) {
    console.error("listTokens error:", err.message);
    return res.status(500).json({ error: "Failed to load tokens" });
  }
}

const MAX_CUSTOM_TOKENS = 50;

async function addToken(req, res) {
  try {
    const { chainId, address, symbol, decimals } = req.body;
    const chain = getChain(chainId);
    if (!chain) {
      return res.status(400).json({ error: "Unknown or disabled chain" });
    }
    if (!ADDRESS_RE.test(address || "")) {
      return res.status(400).json({ error: "Invalid contract address" });
    }
    if (!symbol || typeof symbol !== "string" || symbol.length > 24) {
      return res.status(400).json({ error: "Invalid token symbol" });
    }
    const claimedDecimals = Number(decimals);
    if (!Number.isInteger(claimedDecimals) || claimedDecimals < 0 || claimedDecimals > 36) {
      return res.status(400).json({ error: "Invalid token decimals" });
    }

    const user = await scopedRepo(req.user._id).self.get("customTokens");
    const lower = address.toLowerCase();
    const exists = (user.customTokens || []).some(
      (t) => t.chainId === Number(chainId) && t.address.toLowerCase() === lower
    );
    if (exists) return res.status(201).json({ tokens: user.customTokens });

    if ((user.customTokens || []).length >= MAX_CUSTOM_TOKENS) {
      return res.status(400).json({
        error: `You can keep ${MAX_CUSTOM_TOKENS} custom tokens. Remove one before adding another.`,
      });
    }

    const meta = await readTokenMeta(chain, address);
    if (!meta || !meta.readable) {
      return res.status(502).json({
        error:
          `The contract at ${address} on ${chain.name} did not answer with a symbol and decimals, ` +
          `so it was not added. That is either not a token contract, or ${chain.name} could not be ` +
          `reached just now. Nothing was saved.`,
      });
    }

    if (meta.decimals !== claimedDecimals) {
      return res.status(400).json({
        error:
          `The contract at ${address} reports ${meta.decimals} decimals and this request said ` +
          `${claimedDecimals}. Those disagree, so it was refused rather than guessed: trading on ` +
          `the wrong decimals moves the wrong amount.`,
      });
    }

    for (const candidate of [String(symbol), String(meta.symbol || "")]) {
      const upper = candidate.toUpperCase();
      if (!upper) continue;
      const clash = tokensFor(chain).find(
        (t) => String(t.symbol).toUpperCase() === upper && String(t.address).toLowerCase() !== lower
      );
      if (clash) {
        return res.status(400).json({
          error:
            `The verified ${clash.symbol} on ${chain.name} is at ${clash.address}. Two contracts ` +
            `cannot both be ${clash.symbol}, so this one was refused. Trade the verified one, or ` +
            `add this contract under a name that does not copy it.`,
        });
      }
    }

    user.customTokens.push({
      chainId: Number(chainId),
      address,
      symbol: String(symbol),
      decimals: meta.decimals,
    });
    await user.save();
    return res.status(201).json({ tokens: user.customTokens });
  } catch (err) {
    console.error("addToken error:", err.message);
    return res.status(500).json({ error: "Failed to add token" });
  }
}

async function removeToken(req, res) {
  try {
    const { chainId, address } = req.body;
    const user = await scopedRepo(req.user._id).self.get("customTokens");
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

async function resolveToken(req, res) {
  try {
    const coinId = String(req.query.coinId || "").trim().toLowerCase();
    const chainId = Number(req.query.chainId || NaN);

    if (!/^[a-z0-9][a-z0-9._-]{0,80}$/.test(coinId)) {
      return res.status(400).json({ error: "That is not a valid coin id." });
    }
    if (!Number.isInteger(chainId) || !getChain(chainId)) {
      return res.status(400).json({ error: "Unknown or disabled chain" });
    }

    const result = await resolveCoinOnChain({ coinId, chainId });
    return res.json(result);
  } catch (err) {
    console.error("trading resolveToken error:", err.message);
    return res.status(500).json({ error: "Could not check that coin against the network." });
  }
}

module.exports = {
  setMode,
  listTokens,
  addToken,
  removeToken,
  resolveToken,
  assertCanTradeLive,
  isDemo,
};
