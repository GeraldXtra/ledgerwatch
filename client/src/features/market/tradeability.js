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

  bitcoin: ["WBTC", "CBBTC", "BTCB", "BTC.B"],
  "wrapped-bitcoin": ["WBTC"],
  "coinbase-wrapped-btc": ["CBBTC"],
  "binance-bitcoin": ["BTCB"],

  chainlink: ["LINK"],
  uniswap: ["UNI"],
  aave: ["AAVE"],
  arbitrum: ["ARB"],
  optimism: ["OP"],
  "pancakeswap-token": ["CAKE"],
};

export function tokensForChain(chain, customTokens = []) {
  if (!chain) return [];
  const custom = customTokens
    .filter((t) => t.chainId === chain.chainId)
    .map((t) => ({ ...t, custom: true }));
  return [...(chain.tokens || []), ...custom];
}

export function resolveToken(chain, { coinId, symbol }, customTokens = []) {
  const tokens = tokensForChain(chain, customTokens);
  const mapped = NATIVE_EQUIVALENT[String(coinId || "").toLowerCase()] || [];

  if (mapped.length) {
    const byCoinId = new Set(mapped.map((x) => String(x).toUpperCase()));
    const hit = tokens.find((t) => byCoinId.has(String(t.symbol).toUpperCase()));
    if (hit) return { token: hit, matchedBy: "coinId" };
  }

  const ticker = String(symbol || "").toUpperCase();
  const wanted = new Set([ticker, `W${ticker}`].filter(Boolean));
  const hit = tokens.find((t) => wanted.has(String(t.symbol).toUpperCase()));
  if (!hit) return { token: null, matchedBy: null };
  return { token: hit, matchedBy: hit.custom ? "coinId" : "symbol" };
}

const CASH_SYMBOLS = [/^USDC$/i, /^(USDT|USD₮0|USDT0|USDt)$/i];

export const CASH_CHOICES = ["USDC", "USDT"];

function cashPattern(choice) {
  return String(choice).toUpperCase() === "USDT" ? CASH_SYMBOLS[1] : CASH_SYMBOLS[0];
}

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

export function cashChoiceOf(token) {
  if (!token) return null;
  return CASH_SYMBOLS[1].test(token.symbol) ? "USDT" : CASH_SYMBOLS[0].test(token.symbol) ? "USDC" : null;
}

export function isCashToken(token) {
  return Boolean(token && CASH_SYMBOLS.some((p) => p.test(token.symbol)));
}

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
    return {
      live: false,
      code: "no-token",
      reason: `${coin.symbol} has no verified contract on ${chain.name}. Add it by address in the wallet if you know it, or trade it on paper.`,
      token: null,
      cash,
    };
  }
  if (isCashToken(token)) {
    return {
      live: false,
      code: "is-cash",
      reason: `${coin.symbol} is a dollar stablecoin, and live trades are funded in dollars. Buying it with ${cash.symbol} would only cost you the swap fee.`,
      token,
      cash,
    };
  }

  return { live: true, code: "ok", reason: "", token, cash, matchedBy };
}
