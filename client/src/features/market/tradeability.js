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
 * Resolve a watched coin to a token contract on this chain.
 *
 * TWO KINDS OF MATCH, AND ONLY ONE OF THEM IS EVIDENCE.
 *
 * `NATIVE_EQUIVALENT` is a curated map from a specific CoinGecko id to the
 * symbols that represent it on chain. A hit there is authoritative: somebody
 * decided that this coin is that token.
 *
 * A bare TICKER match is not. Tickers are not unique in crypto — dozens of coins
 * share one — and the index this product watches lists about twenty thousand
 * of them. So a watch on an obscure coin that happens to be called "OP" or "ARB"
 * or "AAVE" matched the registry's verified contract for a COMPLETELY DIFFERENT
 * asset, and a live buy spent real money on it. The contract was genuine, which
 * is what made it hard to see; it was simply not the thing the alert was about.
 *
 * Worse, it short-circuited the fix: `resolveTradeable` only asks the server for
 * a contract-verified answer when the local rules return `no-token`, so a false
 * ticker match meant the on-chain check never ran.
 *
 * The match is still made — refusing outright would break every ordinary trade —
 * but it is LABELLED, and `resolveTradeable` cross-checks a ticker-only match
 * against the server before anything can be signed for.
 *
 * @returns {{token: object|null, matchedBy: "coinId"|"symbol"|null}}
 */
export function resolveToken(chain, { coinId, symbol }, customTokens = []) {
  const tokens = tokensForChain(chain, customTokens);
  const mapped = NATIVE_EQUIVALENT[String(coinId || "").toLowerCase()] || [];

  // The curated map first, and on its own, so an authoritative hit can never be
  // beaten to it by a coincidental ticker.
  if (mapped.length) {
    const byCoinId = new Set(mapped.map((x) => String(x).toUpperCase()));
    const hit = tokens.find((t) => byCoinId.has(String(t.symbol).toUpperCase()));
    if (hit) return { token: hit, matchedBy: "coinId" };
  }

  // A token the user added themselves is their own assertion about which
  // contract this is, so it counts as deliberate rather than coincidental.
  const ticker = String(symbol || "").toUpperCase();
  const wanted = new Set([ticker, `W${ticker}`].filter(Boolean));
  const hit = tokens.find((t) => wanted.has(String(t.symbol).toUpperCase()));
  if (!hit) return { token: null, matchedBy: null };
  return { token: hit, matchedBy: hit.custom ? "coinId" : "symbol" };
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
const CASH_SYMBOLS = [/^USDC$/i, /^(USDT|USD₮0|USDT0|USDt)$/i];

/** The two the owner can choose between, by the name a person would use. */
export const CASH_CHOICES = ["USDC", "USDT"];

function cashPattern(choice) {
  return String(choice).toUpperCase() === "USDT" ? CASH_SYMBOLS[1] : CASH_SYMBOLS[0];
}

/**
 * @param {object} chain
 * @param {"USDC"|"USDT"} [preferred]  which dollar to fund trades with. Absent,
 *        USDC wins where both exist. If the preferred one is not on this chain
 *        the other is used, so a preference never silently disables trading;
 *        `tradeability` reports which one was actually chosen.
 */
export function cashTokenFor(chain, preferred) {
  const stables = chain?.stables || (chain?.tokens || []).filter((t) => /^USD/i.test(t.symbol));
  const order = preferred
    ? [cashPattern(preferred), ...CASH_SYMBOLS.filter((p) => p !== cashPattern(preferred))]
    : CASH_SYMBOLS;
  for (const pattern of order) {
    const hit = stables.find((t) => pattern.test(t.symbol));
    if (hit) return hit;
  }
  return null;
}

/** Which of the two choices a given cash token is. */
export function cashChoiceOf(token) {
  if (!token) return null;
  return CASH_SYMBOLS[1].test(token.symbol) ? "USDT" : CASH_SYMBOLS[0].test(token.symbol) ? "USDC" : null;
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
 * `code` is the same answer for a program rather than a person: "no-chain",
 * "no-dex", "no-cash", "no-token", "is-cash" or "ok". A caller that needs to act
 * on WHICH refusal this is must read the code, never the sentence — the sentence
 * is written for the screen and is expected to be rewritten.
 *
 * @returns {{live:boolean, code:string, reason:string, token:object|null, cash:object|null}}
 */
export function tradeability(chain, coin, customTokens = [], preferredCash) {
  if (!chain) {
    return { live: false, code: "no-chain", reason: "No network selected.", token: null, cash: null };
  }
  if (!chain.dex) {
    return {
      live: false,
      code: "no-dex",
      reason: `${chain.name} has no verified exchange, so everything here is paper only.`,
      token: null,
      cash: null,
    };
  }
  const cash = cashTokenFor(chain, preferredCash);
  if (!cash) {
    return {
      live: false,
      code: "no-cash",
      reason: `Live trading needs USDC or USDT on ${chain.name}, and neither is configured there. Trade this on paper instead.`,
      token: null,
      cash: null,
    };
  }
  const { token, matchedBy } = resolveToken(chain, coin, customTokens);
  if (!token) {
    /**
      * NOT THE FINAL ANSWER ANY MORE.
      *
      * This used to be where every coin outside the registry stopped, which was
      * almost every coin a person would search for. The registry holds about a
      * dozen assets; the chain holds thousands. `resolveTradeable.js` takes this
      * exact code and asks the server, which looks the contract up in the coin
      * index and then reads `symbol()` and `decimals()` off the chain before
      * agreeing it is real.
      *
      * The sentence stays useful because it is what the user sees when that
      * lookup also comes back empty.
      */
    return {
      live: false,
      code: "no-token",
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
      code: "is-cash",
      reason: `${coin.symbol} is a dollar stablecoin, and live trades are funded in dollars. Buying it with ${cash.symbol} would only cost you the swap fee.`,
      token,
      cash,
    };
  }

  // Everything is in place. Whether a POOL exists with usable liquidity is only
  // knowable from a live quote, which planSwap performs before anything is signed.
  // `matchedBy` travels with the answer so `resolveTradeable` knows whether this
  // contract was identified by the curated coin map or merely by a ticker.
  return { live: true, code: "ok", reason: "", token, cash, matchedBy };
}
