const User = require("../models/User");
const publicUser = require("../utils/publicUser");
const { getChain, tokensFor } = require("../config/chains");
const { resolveCoinOnChain } = require("../services/tokenResolver.service");
// The same contract read the discovery path and the coin resolver use, so a
// token added by hand is held to the checks a token that arrives uninvited is.
const { readTokenMeta } = require("../services/walletHistory.service");

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

/** Reused by the execution paths, so the lock cannot be bypassed by route. */
function assertCanTradeLive(user) {
  if (isDemo(user)) {
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

/**
 * Nobody trades a hundred hand-added tokens, and the list lives on the user
 * document, which is loaded on every authenticated request.
 */
const MAX_CUSTOM_TOKENS = 50;

/**
 * POST /api/trading/tokens  { chainId, address, symbol, decimals }
 *
 * THE OTHER DOOR ONTO THE SAME RISK (LW-090).
 *
 * LW-090 established the rule that a contract whose ticker copies a verified
 * token at a DIFFERENT address is refused, because somebody searching for a
 * popular ticker will pick the wrong entry from a list of look-alikes. That
 * refusal was built into `/trading/resolve` and this endpoint, which predates
 * it, had none of it: any ticker up to twenty-four characters, at any address,
 * with the decimals taken on the browser's word. Custom tokens are tradeable
 * and appear in the wallet, so a hand-added fake USDC displayed as USDC
 * everywhere and could be signed for with no warning at all.
 *
 * So this endpoint now asks the same two questions `/trading/resolve` asks, of
 * the same sources:
 *
 *  - THE CONTRACT, for its symbol and decimals. CLAUDE.md is unambiguous that
 *    decimals are read from the contract and never taken from a caller: wrong
 *    decimals misread every balance for that token and move the wrong amount in
 *    a trade. A contract that cannot be read cannot be added — hard rule 10.
 *  - THE REGISTRY, for a symbol collision at a different address. That is a
 *    contradiction rather than a coincidence: two contracts cannot both be the
 *    verified USDC on one chain.
 *
 * A well-known ticker with no registry entry on this chain is NOT refused, for
 * the reason set out at length in tokenResolver.service.js: that would block
 * legitimate bridged tokens, which is most of what this endpoint exists for.
 */
async function addToken(req, res) {
  try {
    const { chainId, address, symbol, decimals } = req.body || {};
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
    // Still validated, because it is compared against the contract below and a
    // non-number would make that comparison meaningless rather than false.
    const claimedDecimals = Number(decimals);
    if (!Number.isInteger(claimedDecimals) || claimedDecimals < 0 || claimedDecimals > 36) {
      return res.status(400).json({ error: "Invalid token decimals" });
    }

    const user = await User.findById(req.user._id).select("customTokens");
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

    // Read the contract. A failure here is reported, never assumed away: an
    // unreadable contract is "we could not check", which is not "it is fine".
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

    // The symbol that would be DISPLAYED, and the symbol the contract answers
    // with, are both checked. The first is what a person would be deceived by;
    // the second is what the contract is claiming to be.
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
      // The chain's own answer, not the caller's. They agree by the check above;
      // storing the contract's value means they cannot drift apart later.
      decimals: meta.decimals,
    });
    await user.save();
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

/**
 * GET /api/trading/resolve?coinId=&chainId=
 *
 * WHAT A COIN IS, ON ONE CHAIN. This is what lifts trading off the dozen assets
 * the registry carries by hand and onto everything the chain actually holds.
 *
 * It answers with a token or with a SENTENCE saying why not, and the caller
 * shows that sentence. There is deliberately no third outcome: an empty answer
 * with no reason is how "paper only" came to look like a bug rather than a fact.
 *
 * Read-only, authenticated, rate limited, and it touches nothing the user owns.
 * The heavy lifting and the on-chain cross-check are in tokenResolver.service.
 */
async function resolveToken(req, res) {
  try {
    const coinId = String((req.query && req.query.coinId) || "").trim().toLowerCase();
    const chainId = Number((req.query && req.query.chainId) || NaN);

    // CoinGecko ids are lowercase words joined by hyphens. Bounded and shaped
    // here so nothing unexpected reaches a URL path segment upstream.
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
