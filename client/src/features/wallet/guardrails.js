export const DEFAULT_LIMITS = {
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

export function limitsFor(chain, overrides) {
  const base = chain && !chain.testnet ? DEFAULT_LIMITS.mainnet : DEFAULT_LIMITS.testnet;
  const clean = {};
  for (const [key, value] of Object.entries(overrides || {})) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) clean[key] = n;
  }
  return { ...base, ...clean };
}

let sessionSpend = 0;
export function sessionSpent() {
  return sessionSpend;
}
export function recordSessionSpend(amount) {
  sessionSpend += Number(amount) || 0;
}

export function checkTrade({ amount, limits, spentToday = 0, impactPct = 0, nativeAfterWei = null }) {
  const blocks = [];
  const warnings = [];
  const spend = Number(amount) || 0;

  if (spend <= 0) blocks.push("Enter an amount greater than zero.");

  if (spend > limits.perTrade) {
    blocks.push(
      `That is over the ${limits.perTrade} per trade cap, which is fixed for this network. Split it into smaller trades, or lower the amount.`
    );
  }

  if (spentToday + spend > limits.perDay) {
    const left = Math.max(0, limits.perDay - spentToday);
    blocks.push(
      `That would pass your daily cap of ${limits.perDay}. You have ${left.toFixed(2)} left in the last 24 hours.`
    );
  }

  const session = sessionSpent();
  if (session + spend > limits.perSession) {
    const left = Math.max(0, limits.perSession - session);
    blocks.push(
      `That would pass this session's cap of ${limits.perSession}. ${left.toFixed(2)} remaining until you reload.`
    );
  }

  if (nativeAfterWei !== null) {
    const floorWei = BigInt(Math.round(limits.minNativeFloor * 1e18));
    if (nativeAfterWei < floorWei) {
      blocks.push(
        `This would leave too little native token to pay for another transaction. Keep at least ${limits.minNativeFloor} in reserve, or you will not be able to move these funds afterwards.`
      );
    }
  }

  const needsExtraConfirm = impactPct > limits.maxPriceImpactPct;
  if (needsExtraConfirm) {
    warnings.push(
      `Price impact is ${impactPct.toFixed(2)}%, above your ${limits.maxPriceImpactPct}% threshold. You would lose roughly that share of the trade's value to the pool's thinness.`
    );
  }

  return { ok: blocks.length === 0, blocks, warnings, needsExtraConfirm };
}
