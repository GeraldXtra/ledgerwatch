import http from "../../api/http";
import { tradeability, isCashToken } from "./tradeability";

/**
 * "EVERY COIN", AND THE ONE EXTRA QUESTION THAT MAKES IT TRUE.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS WRONG
 * ---------------------------------------------------------------------------
 * Market Watch has always let anyone watch any of the twenty thousand coins the
 * index lists, because watching needs a price and nothing else. Trading was
 * matched against `chains.js`, which carries about a dozen assets that were
 * verified by hand. So the honest answer to "buy this" was "paper only" for
 * essentially every coin somebody would actually search for, and the message
 * blamed the chain for a limit that was ours.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE MODULE
 * ---------------------------------------------------------------------------
 * `tradeability.js` has no imports at all. That is deliberate: it is pure, it is
 * tested without a network, and every rule about what may be traded lives in one
 * readable place. Reaching for the server from inside it would have made the
 * whole rule set async and untestable in isolation, so the network call lives
 * here and the rules stay where they are.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER, AND WHY IT IS THIS ORDER
 * ---------------------------------------------------------------------------
 * 1. Ask the pure rules first. A registry token, a user's own custom token, a
 *    chain with no exchange, a chain with no dollar — all answered instantly,
 *    offline, exactly as before. Nothing about the common path changes.
 * 2. Only `no-token` is worth a question. Every other refusal is a fact about
 *    the CHAIN, and no lookup can change it: a chain with no verified router
 *    cannot swap whatever the coin turns out to be.
 * 3. The server resolves and verifies. It reads the contract's own `symbol()`
 *    and `decimals()` on that chain and refuses on any disagreement. See
 *    `server/src/services/tokenResolver.service.js` for why decimals are the
 *    field that decides.
 * 4. The stablecoin rule is applied AGAIN to whatever comes back. A coin that
 *    resolved to a dollar would otherwise slip past the check that stops a
 *    dollar being bought with a dollar, since that check ran in step 1 against a
 *    token that had not been resolved yet.
 *
 * A verified contract still does not mean a trade is possible. Whether a POOL
 * exists deep enough to fill this size is only knowable from a live quote, and
 * `planSwap` does that before anything is signed.
 */

/**
 * @param {{chain:object, coin:{coinId:string, symbol:string}, customTokens?:Array, preferredCash?:string}} args
 * @returns {Promise<{live:boolean, code:string, reason:string, token:object|null, cash:object|null, warnings?:string[], source?:string}>}
 */
export async function resolveTradeable({ chain, coin, customTokens = [], preferredCash }) {
  const local = tradeability(chain, coin, customTokens, preferredCash);

  /**
   * A TICKER MATCH IS NOT AN IDENTIFICATION. CHECK IT BEFORE IT IS SIGNED FOR.
   *
   * `tradeability` reports HOW it found the contract. A `coinId` match came from
   * the curated map, or from a token this user added themselves, and is taken as
   * given. A `symbol` match is a coincidence of tickers — and tickers are not
   * unique across the twenty thousand coins the index lists, so this is where a
   * watch on one asset quietly bought a different one.
   *
   * The original ordering made that unreachable: only `no-token` asked the
   * server, so a false ticker match skipped the on-chain check entirely. Now a
   * ticker-only match is confirmed against the resolver, which reads `symbol()`
   * and `decimals()` on the chain, and the SERVER's answer wins on disagreement.
   */
  if (local.code === "ok" && local.matchedBy === "symbol") {
    const checked = await verifyAgainstServer({ chain, coin, local });
    if (checked) return checked;
  }

  if (local.code !== "no-token") return local;

  let data;
  try {
    const res = await http.get("/api/trading/resolve", {
      params: { coinId: coin.coinId, chainId: chain.chainId },
    });
    data = res.data;
  } catch (err) {
    /**
     * NEVER SILENT, AND NEVER OPTIMISTIC. A failed lookup is reported as a
     * failed lookup; it does not fall back to "paper only" with the old
     * sentence, which would tell the user this coin cannot be traded here when
     * what actually happened is that we could not find out.
     */
    const detail = err?.response?.data?.error || err?.message || "the check could not be completed";
    return {
      ...local,
      code: "lookup-failed",
      reason: `${coin.symbol} could not be checked against ${chain.name} just now (${detail}). Nothing was assumed. Try again in a moment, or trade it on paper.`,
    };
  }

  if (!data || !data.ok || !data.token) {
    return { ...local, code: "no-token", reason: (data && data.reason) || local.reason };
  }

  // Step 4. The same rule as in `tradeability`, applied to the resolved token.
  if (isCashToken(data.token)) {
    return {
      live: false,
      code: "is-cash",
      reason: `${coin.symbol} is a dollar stablecoin, and live trades are funded in dollars. Buying it with ${local.cash?.symbol || "a dollar"} would only cost you the swap fee.`,
      token: data.token,
      cash: local.cash,
    };
  }

  return {
    live: true,
    code: "ok",
    reason: "",
    token: data.token,
    cash: local.cash,
    // Shown beside the address on the confirm screen. Currently the one case is
    // a contract whose symbol differs from the listing, which is normal for
    // bridged and wrapped assets and worth a second look before signing.
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
    source: data.source || null,
  };
}

/**
 * Confirm a ticker-only match against the server's contract-verified resolver.
 *
 * Returns a replacement answer, or null to keep the local one. Never throws: a
 * lookup that cannot be completed must not block a trade the registry already
 * considers verified, but it does say so on the confirm screen.
 */
async function verifyAgainstServer({ chain, coin, local }) {
  let data;
  try {
    const res = await http.get("/api/trading/resolve", {
      params: { coinId: coin.coinId, chainId: chain.chainId },
    });
    data = res.data;
  } catch {
    return {
      ...local,
      warnings: [
        ...(local.warnings || []),
        `${coin.symbol} was matched to a verified ${chain.name} contract by its ticker alone, and ` +
          "that could not be double-checked just now. Tickers are not unique — confirm the address " +
          "below is the asset you mean before you sign.",
      ],
    };
  }

  if (!data || !data.ok || !data.token) return null;

  const same =
    String(data.token.address).toLowerCase() === String(local.token.address).toLowerCase();
  if (same) return { ...local, source: data.source || null };

  /**
   * THE CASE THIS WHOLE FUNCTION EXISTS FOR. The registry holds a verified
   * contract with this ticker, and the coin the user is actually watching is a
   * different asset that happens to share it. The server resolved the real one
   * from the coin index and confirmed it on chain, so that is the answer.
   */
  return {
    live: true,
    code: "ok",
    reason: "",
    token: data.token,
    cash: local.cash,
    warnings: [
      ...(Array.isArray(data.warnings) ? data.warnings : []),
      `${coin.symbol} shares its ticker with a different token already verified on ${chain.name}. ` +
        "The contract below is the one that matches the coin you are watching, not the one with the " +
        "same ticker. Check it before you sign.",
    ],
    source: data.source || null,
  };
}
