/**
 * HONEST TRADEABILITY.
 *
 * A coin is "live tradeable" on a chain only when it has a REAL, verified token
 * contract there. The chain registry is the only source of addresses, and it
 * contains nothing that was not read off the chain itself.
 *
 * There is deliberately no fallback, no guess and no lookup table of "probably
 * this address". A coin that is not in the registry for the selected chain is
 * PAPER ONLY, and says why. Inventing an address would send real funds to
 * something nobody controls.
 */

/**
 * CoinGecko ids map onto the wrapped native token where that is what the chain
 * actually trades. ETH is not an ERC-20; every DEX trades WETH, and on an
 * OP-stack chain that is the canonical predeploy already in the registry.
 */
const NATIVE_EQUIVALENT = {
  ethereum: ["WETH"],
  "wrapped-ether": ["WETH"],
  weth: ["WETH"],
  "matic-network": ["WPOL", "WMATIC"],
  "polygon-ecosystem-token": ["WPOL"],
  binancecoin: ["WBNB"],
  "avalanche-2": ["WAVAX"],
  "usd-coin": ["USDC"],
  tether: ["USDT", "USD₮0"],
};

/** All tokens usable on a chain: verified registry entries plus user additions. */
export function tokensForChain(chain, customTokens = []) {
  if (!chain) return [];
  const custom = customTokens
    .filter((t) => t.chainId === chain.chainId)
    .map((t) => ({ ...t, custom: true }));
  return [...(chain.tokens || []), ...custom];
}

/**
 * Resolve a watched coin to a token contract on this chain, or null.
 * Matching is by symbol and by the native-equivalent table above — never by
 * fuzzy name, which is how the wrong contract gets picked.
 */
export function resolveToken(chain, { coinId, symbol }, customTokens = []) {
  const tokens = tokensForChain(chain, customTokens);
  const wanted = new Set(
    [
      ...(NATIVE_EQUIVALENT[String(coinId || "").toLowerCase()] || []),
      String(symbol || "").toUpperCase(),
      `W${String(symbol || "").toUpperCase()}`,
    ].filter(Boolean)
  );
  return tokens.find((t) => wanted.has(String(t.symbol).toUpperCase())) || null;
}

/** The stablecoin that funds live trading on this chain. USDC first. */
export function cashTokenFor(chain) {
  const stables = chain?.stables || (chain?.tokens || []).filter((t) => /^USD/i.test(t.symbol));
  return stables.find((t) => /^USDC$/i.test(t.symbol)) || stables[0] || null;
}

/**
 * Can this coin be traded live on this chain, and if not, exactly why?
 * The reason is shown to the user — "paper only" with no explanation reads as a
 * bug rather than a fact about the network.
 *
 * @returns {{live:boolean, reason:string, token:object|null, cash:object|null}}
 */
export function tradeability(chain, coin, customTokens = []) {
  if (!chain) {
    return { live: false, reason: "No network selected.", token: null, cash: null };
  }
  if (!chain.dex) {
    return {
      live: false,
      reason: `${chain.name} has no verified exchange, so everything here is paper only.`,
      token: null,
      cash: null,
    };
  }
  const cash = cashTokenFor(chain);
  if (!cash) {
    return {
      live: false,
      reason: `No stablecoin is configured on ${chain.name} to fund trades.`,
      token: null,
      cash: null,
    };
  }
  const token = resolveToken(chain, coin, customTokens);
  if (!token) {
    return {
      live: false,
      reason: `${coin.symbol} has no verified contract on ${chain.name}. Add it by address in the wallet if you know it, or trade it on paper.`,
      token: null,
      cash,
    };
  }
  if (token.address.toLowerCase() === cash.address.toLowerCase()) {
    return {
      live: false,
      reason: `${coin.symbol} is the currency trades are funded in on this network, so it cannot be traded against itself.`,
      token,
      cash,
    };
  }

  // Everything is in place. Whether a POOL exists with usable liquidity is only
  // knowable from a live quote, which planSwap performs before anything is signed.
  return { live: true, reason: "", token, cash };
}
