const { getChain, tokensFor } = require("../config/chains");
const { readTokenMeta, impersonationOf } = require("./walletHistory.service");
const cg = require("./coingecko.service");

/**
 * ANY COIN, ON ANY CHAIN THIS APP CAN REACH — RESOLVED, THEN VERIFIED ON CHAIN.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS SOLVES
 * ---------------------------------------------------------------------------
 * Market Watch has always let a user watch ANY of the twenty thousand coins
 * CoinGecko lists, because watching needs nothing but a price. Trading was a
 * different story: `tradeability.js` on the client matched a watched coin
 * against `chains.js` BY SYMBOL, and the registry carries about a dozen assets
 * in total. So the answer to "buy this coin" was "paper only" for essentially
 * every coin a person would actually search for, and the message said so
 * without ever saying it was a limit of our own registry rather than of the
 * chain.
 *
 * The registry cannot be the answer here. Hand-verifying every token on seven
 * chains is not a task that finishes, and CLAUDE.md rule 1 — never invent a
 * contract address — makes guessing the alternative that loses money.
 *
 * ---------------------------------------------------------------------------
 * THE MECHANISM: A NAMED SOURCE, THEN THE CHAIN ITSELF
 * ---------------------------------------------------------------------------
 * Two independent steps, and BOTH must agree before a token can be traded.
 *
 *   1. WHERE IT CLAIMS TO LIVE. CoinGecko's `detail_platforms` gives a contract
 *      address per chain, with the decimals it believes that contract uses.
 *      This is a named reputable source, which is what the security rules
 *      permit; it is not a guess and not a pattern.
 *   2. WHAT THE CONTRACT ACTUALLY SAYS. `symbol()`, `name()` and `decimals()`
 *      are read off that exact address on that exact chain, through the one
 *      server-to-chain path. A contract that cannot be read is refused.
 *
 * DECIMALS ARE THE FIELD THAT DECIDES. If the two sources disagree on decimals,
 * this refuses outright rather than picking one. That is not caution for its own
 * sake: amounts are computed from decimals, so an address that is stale or right
 * for a DIFFERENT token typically differs there first, and trading on the wrong
 * number moves a thousand times what the user typed, or a thousandth of it. The
 * chain's own answer is the one used downstream in every case; CoinGecko's is
 * only ever a cross-check.
 *
 * SYMBOLS ARE REPORTED, NOT ENFORCED. Real tokens disagree with their listing
 * all the time — Arbitrum's Tether reads back as "USD₮0", Avalanche's bridged
 * bitcoin as "BTC.b" — so a hard symbol match would refuse legitimate assets and
 * teach nobody anything. The mismatch is returned as a fact for the UI to show
 * beside the address.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 * It does not decide that a trade is possible. A verified address only means the
 * token is real and its arithmetic is known. Whether a POOL exists with usable
 * liquidity is a separate question that only a live quote can answer, and that
 * still happens in `planSwap` before anything is signed.
 *
 * It does not touch a key, and it never sees one. This is a read path.
 */

/** How long a resolution is trusted. A token's address does not move. */
const RESOLVE_TTL = 6 * 60 * 60 * 1000; // 6h

/**
 * How long a REFUSAL is remembered. Deliberately short and deliberately
 * separate: a cache that latched "no" for six hours would turn one bad minute
 * on an RPC endpoint into an afternoon of "this coin cannot be traded", which
 * is the exact failure mode CLAUDE.md §9 warns about. Long enough to stop a
 * hammering retry loop, short enough that a recovered chain is noticed.
 */
const REFUSAL_TTL = 60 * 1000; // 1 min

const cache = new Map(); // `${coinId}:${chainId}` -> { data, ts, ok }

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Same shape for every refusal, so no caller has to guess what came back. */
function refuse(reason, extra = {}) {
  return { ok: false, reason, token: null, ...extra };
}

function cacheKey(coinId, chainId) {
  return `${String(coinId).toLowerCase()}:${Number(chainId)}`;
}

function readCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  const ttl = entry.ok ? RESOLVE_TTL : REFUSAL_TTL;
  if (Date.now() - entry.ts > ttl) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * The cache has a CEILING, and it needs one.
 *
 * The only path that removed an entry was `readCache` expiring a key somebody
 * asked for again, so a coin looked up once and never again stayed for the life
 * of the process. There are around twenty thousand listed coins across seven
 * networks, and a signed-in user can trigger twenty lookups every five minutes,
 * so the map only ever grew. Each entry is small, which makes this slow rather
 * than dangerous — the kind of thing that surfaces months later on a small host
 * as a restart, which on this server also restarts the payment watcher. The
 * settlement service's debounce map was bounded after review for exactly this
 * reason; the pattern is already established here.
 *
 * Expired entries are dropped first, because they are free; only if that is not
 * enough does the oldest live entry go. Deleting before setting keeps the
 * insertion order meaningful.
 */
const MAX_CACHE_ENTRIES = 5000;

function writeCache(key, data) {
  cache.delete(key);
  cache.set(key, { data, ts: Date.now(), ok: data.ok === true });
  if (cache.size <= MAX_CACHE_ENTRIES) return;

  const now = Date.now();
  for (const [k, entry] of cache) {
    if (now - entry.ts > (entry.ok ? RESOLVE_TTL : REFUSAL_TTL)) cache.delete(k);
  }
  for (const k of cache.keys()) {
    if (cache.size <= MAX_CACHE_ENTRIES) break;
    cache.delete(k);
  }
}

/**
 * Resolve a watched coin to a tradeable token on one chain.
 *
 * Order matters, and it is cheapest-and-most-trusted first:
 *
 *   a. THE REGISTRY, BY ADDRESS. Everything in `chains.js` was verified against
 *      the live chain by `verify:chains`, so a hit there needs no further work
 *      and carries the label the contract itself reports.
 *   b. THE CHAIN'S OWN CURRENCY. Asking to buy ETH on Base means the wrapped
 *      native, because a DEX cannot hand back a native coin. CoinGecko's
 *      `native_coin_id` per platform says which coin that is, so this needs no
 *      hand-written synonym table (the client's NATIVE_EQUIVALENT map is one,
 *      and it covers about a dozen coins).
 *   c. COINGECKO'S ADDRESS, VERIFIED ON CHAIN. The general case, above.
 *
 * @param {{coinId:string, chainId:number|string}} args
 * @returns {Promise<{ok:true, token:object, source:string, warnings:string[]}|{ok:false, reason:string, token:null}>}
 */
async function resolveCoinOnChain({ coinId, chainId }) {
  const id = String(coinId || "").trim().toLowerCase();
  const numericChainId = Number(chainId);
  if (!id) return refuse("No coin was given.");
  if (!Number.isInteger(numericChainId)) return refuse("No network was given.");

  const key = cacheKey(id, numericChainId);
  const hit = readCache(key);
  if (hit) return hit;

  const result = await doResolve(id, numericChainId);
  writeCache(key, result);
  return result;
}

async function doResolve(id, chainId) {
  const chain = getChain(chainId);
  if (!chain) {
    return refuse("That network is not available, so nothing can be traded on it here.");
  }

  // ---- which CoinGecko platform IS this chain? ------------------------------
  //
  // `available` is checked BEFORE the lookup, and the two failures are reported
  // differently on purpose. Measured while building this: with the index rate
  // limited and nothing cached, the map comes back empty, every chain misses,
  // and the message read "the coin index does not list Ethereum as a network it
  // carries token addresses for" — which is false, permanent-sounding, and
  // blames the chain for a one-minute outage. That is precisely the silent
  // failure that reads as correct which CLAUDE.md §12 is about, so the outage
  // says it is an outage and the caller is told to try again.
  const { platforms, byChainId, available } = await cg.getAssetPlatforms();
  if (!available) {
    return refuse(
      "The coin index could not be reached just now, so which token contracts exist on " +
        `${chain.name} could not be confirmed. Nothing was assumed. Try again shortly.`
    );
  }
  const platformId = byChainId[chainId] || null;
  if (!platformId) {
    return refuse(
      `The coin index does not list ${chain.name} as a network it carries token addresses for, ` +
        `so a contract there cannot be confirmed. Trade this one on paper.`
    );
  }
  const platform = platforms[platformId] || null;

  // ---- b. the chain's own currency maps to its wrapped native --------------
  if (platform && platform.nativeCoinId && platform.nativeCoinId === id) {
    if (!chain.wrappedNative) {
      return refuse(
        `${chain.name} has no verified wrapped ${chain.nativeSymbol} in the registry, and an ` +
          `exchange cannot hand back a native coin. Trade this one on paper.`
      );
    }
    return {
      ok: true,
      source: "registry-wrapped-native",
      // `provenance: "registry"` is a genuinely stronger claim than the
      // index-sourced case below: every registry address was read off the live
      // chain by `npm run verify:chains`. The interface is entitled to say so,
      // and entitled to say the other thing differently.
      token: {
        ...chain.wrappedNative,
        contractReadable: true,
        provenance: "registry",
        chainId: chain.chainId,
      },
      warnings: [],
    };
  }

  // ---- where does the coin claim to live on this chain? --------------------
  const coin = await cg.getCoinPlatforms(id);
  if (!coin) {
    return refuse(
      "The coin index could not be reached just now, so this token's contract address could not " +
        "be confirmed. Nothing was assumed. Try again shortly."
    );
  }
  // Distinct from the outage above on purpose: this one will never succeed, so
  // the message must not invite the user to try again.
  if (coin.notFound) {
    return refuse(`The coin index has no record of "${id}", so there is no contract to look up.`);
  }

  const claim = coin.platforms[platformId] || null;
  if (!claim) {
    return refuse(
      `${coin.symbol || id} has no contract on ${chain.name} according to the coin index, so ` +
        `there is nothing to trade there. It may exist on another network.`
    );
  }

  const address = claim.address;
  if (!ADDRESS_RE.test(address)) {
    // Non-EVM platforms (Solana, TON, Tron) have addresses in other formats.
    // This resolver is EVM-only, and says so rather than passing something
    // unusable downstream.
    return refuse(
      `The address the coin index gives for ${coin.symbol || id} on ${chain.name} is not an ` +
        `Ethereum-style address, so it cannot be used here.`
    );
  }
  const lower = address.toLowerCase();

  // ---- a. already in the registry, by ADDRESS not by symbol ----------------
  //
  // By address on purpose. Matching by symbol is how the wrong contract gets
  // picked: any token may call itself USDC, and one that does would otherwise
  // resolve to the real USDC entry and trade something else entirely.
  const registryHit = tokensFor(chain).find((t) => String(t.address).toLowerCase() === lower);
  if (registryHit) {
    return {
      ok: true,
      source: "registry",
      token: { ...registryHit, contractReadable: true, provenance: "registry", chainId: chain.chainId },
      warnings: [],
    };
  }

  // ---- c. read the contract itself ----------------------------------------
  const meta = await readTokenMeta(chain, address);
  // `anyMissing` as well as `transport`: one failed call among the three leaves
  // the contract half read, and calling that "not a token" blames a real
  // contract for a node's bad minute — and then caches the blame.
  if (meta.transport || (!meta.readable && meta.anyMissing)) {
    return refuse(
      `${chain.name} could not be reached to confirm this token's contract, so it was not ` +
        `accepted. Nothing was assumed about it. Try again shortly.`
    );
  }
  if (!meta.readable) {
    return refuse(
      `The contract at ${address} on ${chain.name} does not report a symbol and decimals the ` +
        `way a token must, so it cannot be traded or displayed correctly here.`
    );
  }

  // THE CROSS-CHECK THAT MATTERS. See the note at the top of this file.
  if (claim.decimals != null && claim.decimals !== meta.decimals) {
    return refuse(
      `The coin index says ${coin.symbol || id} on ${chain.name} uses ${claim.decimals} decimals ` +
        `and the contract at ${address} reports ${meta.decimals}. Those disagree, so this was ` +
        `refused rather than guessed: trading on the wrong decimals moves the wrong amount.`
    );
  }

  const warnings = [];

  /**
   * IMPERSONATION, IN THE ONE FORM THAT IS ACTUALLY A CONTRADICTION.
   *
   * The check the discovery path runs, `impersonationOf`, matches two different
   * things: a symbol used by a token in THIS chain's registry, and a symbol on
   * a list of well-known names (ETH, LINK, UNI, ARB, SOL, DOGE and so on). It
   * flags both, which is right for discovery, where the flag is information and
   * the owner decides.
   *
   * Refusing on both would be wrong, and measurably so: UNI on Polygon
   * (0xb33eaad8...) and LINK on a chain the registry has no LINK entry for are
   * legitimate, and both are on the well-known list. Refusing them would break
   * exactly the coins this whole change exists to make tradeable.
   *
   * So the two are separated by what they mean. A REGISTRY collision is a
   * contradiction: we reached here only because this address is not in the
   * registry, so a contract calling itself USDC on a chain whose verified USDC
   * lives elsewhere is claiming to be something it is not. That is refused. A
   * well-known name with no registry entry on this chain is not a
   * contradiction, just a familiar ticker, so it is said out loud beside the
   * address and left to the owner, who has to tick the box either way.
   *
   * This is the control that survives a crafted listing, which the decimals
   * cross-check above cannot: the index supplies both the address and the
   * decimals, so those two agreeing proves less than it looks. The registry is
   * a genuinely separate source, read off the live chain by `verify:chains`.
   */
  const onChainUpper = String(meta.symbol || "").toUpperCase();
  const registryClash = tokensFor(chain).find(
    (t) => String(t.symbol).toUpperCase() === onChainUpper && String(t.address).toLowerCase() !== lower
  );
  if (registryClash) {
    return refuse(
      `The contract at ${address} on ${chain.name} calls itself ${meta.symbol}, but the verified ` +
        `${registryClash.symbol} on this network is at ${registryClash.address}. Two contracts ` +
        `cannot both be ${registryClash.symbol}, so this one was refused. Trade the verified one, ` +
        `or add this contract by address in the wallet if you are certain of it.`
    );
  }

  // Not a contradiction, but worth seeing next to the address before buying.
  const wellKnown = impersonationOf(meta.symbol, chain);
  if (wellKnown) {
    warnings.push(
      `${meta.symbol} is a well known name, and this contract is not the one this app verified ` +
        `for ${chain.name}. That is normal for a bridged version, and it is also what an ` +
        `imitation looks like. Check the address.`
    );
  }

  const claimedSymbol = String(coin.symbol || "").toUpperCase();
  const onChainSymbol = String(meta.symbol || "").toUpperCase();
  if (claimedSymbol && onChainSymbol && claimedSymbol !== onChainSymbol) {
    warnings.push(
      `The contract calls itself ${meta.symbol}, while the coin is listed as ${coin.symbol}. ` +
        `That is normal for bridged and wrapped versions, but check the address before trading.`
    );
  }

  return {
    ok: true,
    source: "coingecko-verified",
    token: {
      // The chain's own answers, not the index's. The index only ever agreed.
      symbol: meta.symbol,
      name: meta.name || coin.name || meta.symbol,
      address,
      decimals: meta.decimals,
      /**
       * NOT `verified`. THE WORD WAS A LIE OF DEGREE.
       *
       * This field read `verified: true`, which to anyone reading it — in code
       * or on a screen — says somebody vouched for this token. Nobody did.
       * What was established is narrower and worth stating exactly: a contract
       * exists at this address, it answers `symbol()` and `decimals()`, its
       * decimals agree with the index that named it, and it is not copying a
       * registry token's symbol.
       *
       * The decimals agreement is weaker than it looks, and that is the reason
       * for the rename: the address and the decimals come from the SAME index
       * entry, so that check compares a source against itself. It catches a
       * stale or mistaken listing, which is the common case. It cannot catch a
       * crafted one. The impersonation refusal above and the owner reading the
       * address before the first live trade are what cover that; this flag is
       * not, and must not be rendered as though it were.
       */
      contractReadable: true,
      // Where the address came from, so the interface can say it plainly
      // instead of showing a hand-verified registry token and an index-sourced
      // one in the same words.
      provenance: "coingecko",
      coinId: id,
      chainId: chain.chainId,
      explorer: chain.explorer ? `${chain.explorer}/token/${address}` : null,
    },
    warnings,
  };
}

/** Test and diagnostic hook. Not used by any request path. */
function _clearCache() {
  cache.clear();
}

module.exports = { resolveCoinOnChain, _clearCache, RESOLVE_TTL, REFUSAL_TTL };
