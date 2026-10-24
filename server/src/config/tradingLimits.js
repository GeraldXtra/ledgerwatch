const DEFAULT_LIMITS = {
  testnet: {
    perTrade: 1000,
    perDay: 5000,
    perSession: 2000,
    minNativeFloor: 0.0005,
    maxPriceImpactPct: 5,
  },
  mainnet: {
    perTrade: 100,
    perDay: 250,
    perSession: 150,
    minNativeFloor: 0.005,
    maxPriceImpactPct: 2,
  },
};

function limitsFor(chain, overrides) {
  const base = chain && !chain.testnet ? DEFAULT_LIMITS.mainnet : DEFAULT_LIMITS.testnet;
  const clean = {};
  const source = overrides && typeof overrides.toObject === "function" ? overrides.toObject() : overrides;
  for (const [key, value] of Object.entries(source || {})) {
    const n = Number(value);
    if (value != null && Number.isFinite(n) && n > 0) clean[key] = n;
  }
  return { ...base, ...clean };
}

module.exports = { DEFAULT_LIMITS, limitsFor };
