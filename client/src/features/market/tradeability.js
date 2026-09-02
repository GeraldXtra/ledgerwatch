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
  ethereum: ["WETH", "WETH.E"],
  "wrapped-ether": ["WETH"],
  weth: ["WETH"],
  "matic-network": ["WPOL", "WMATIC"],
  "polygon-ecosystem-token": ["WPOL"],
  binancecoin: ["WBNB"],
  "avalanche-2": ["WAVAX"],
  "usd-coin": ["USDC"],
  tether: ["USDT", "USD₮0", "USDT0"],

  /**
   * BITCOIN, AND WHAT "BUYING BITCOIN" HONESTLY MEANS HERE.
   *
   * A DEX swap can only ever hand back an ERC-20 on the same chain, so buying
   * bitcoin here buys a WRAPPED bitcoin: an ERC-20 held one for one against real
   * BTC by a custodian. Each chain has its own, with its own symbol, and BNB's
   * carries EIGHTEEN decimals where the others carry eight.
   *
   * This is real bitcoin exposure at the real bitcoin price, and it is what every
   * EVM exchange means by the phrase. It is NOT native bitcoin and it does not
   * reach the Bitcoin wallet in this app: that would need a bridge or a
   * custodian, and this product does neither. The symbols are left exactly as
   * the contracts report them so the two can never be confused on screen.
   *
   * Symbols are compared uppercased, which is why BTC.b appears as BTC.B.
   */
  bitcoin: ["WBTC", "CBBTC", "BTCB", "BTC.B"],
  "wrapped-bitcoin": ["WBTC"],
  "coinbase-wrapped-btc": ["CBBTC"],
  "binance-bitcoin": ["BTCB"],

  // The rest of what the registry can actually trade, verified on chain.
  chainlink: ["LINK"],
  uniswap: ["UNI"],
  aave: ["AAVE"],
  arbitrum: ["ARB"],
  optimism: ["OP"],
  "pancakeswap-token": ["CAKE"],
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

/**
 * The stablecoin that funds live trading on this chain.
 *
 * ONLY USDC or USDT. Live trades are denominated in dollars, so the buying side
 * has to be a dollar. `stables[0]` used to be the fallback, which on a chain
 * whose first stable was anything else would quietly fund trades in a token that
 * is not a dollar and price everything wrongly. An unknown stable is refused
 * rather than assumed.
 *
 * USDC is preferred over USDT where both exist: deeper liquidity on the DEXes
 * this app quotes against, so less slippage on the same size.
 *
 * Arbitrum's USDT self identifies as USD₮0, which is why that is matched
 * explicitly instead of by a loose /^USD/ test that would also catch USDD, USDe
 * and anything else beginning with those three letters.
 */
const CASH_SYMBOLS = [/^USDC$/i, /^(USDT|USD₮0)$/i];

export function cashTokenFor(chain) {
  const stables = chain?.stables || (chain?.tokens || []).filter((t) => /^USD/i.test(t.symbol));
  for (const pattern of CASH_SYMBOLS) {
    const hit = stables.find((t) => pattern.test(t.symbol));
    if (hit) return hit;
  }
  return null;
}

/** Is this token one of the two the app will spend? Used to refuse self trades. */
export function isCashToken(token) {
  return Boolean(token && CASH_SYMBOLS.some((p) => p.test(token.symbol)));
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
      reason: `Live trading needs USDC or USDT on ${chain.name}, and neither is configured there. Trade this on paper instead.`,
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
  /**
   * Refuse any cash token as the thing being BOUGHT, not just the exact one
   * funding this trade. Comparing addresses alone let USDC buy USDT on a chain
   * carrying both: a dollar for a dollar, minus a swap fee and gas, which is a
   * guaranteed small loss dressed up as a trade.
   */
  if (isCashToken(token)) {
    return {
      live: false,
      reason: `${coin.symbol} is a dollar stablecoin, and live trades are funded in dollars. Buying it with ${cash.symbol} would only cost you the swap fee.`,
      token,
      cash,
    };
  }

  // Everything is in place. Whether a POOL exists with usable liquidity is only
  // knowable from a live quote, which planSwap performs before anything is signed.
  return { live: true, reason: "", token, cash };
}
