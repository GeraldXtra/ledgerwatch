/**
 * SPENDING GUARDRAILS for live trading.
 *
 * These did not previously exist anywhere in the app. Live trading without them
 * means a single mistyped amount, or a runaway loop, can drain a wallet with
 * nothing in the way — so they are a prerequisite for live mode, not a polish
 * item.
 *
 * ENFORCED ON THE CLIENT ONLY. This said "AND on the server when the trade is
 * recorded, because a client-side-only limit is a suggestion", which was never
 * true: `recordTx` validates the shape of a hash and an address and nothing
 * else, and it runs AFTER the transaction is broadcast, so it could not gate
 * anything even if it checked. `assertCanTradeLive` is called from exactly one
 * place and only guards setting the mode string.
 *
 * So by this file's own standard these limits ARE a suggestion. They stop an
 * honest mistake, which is most mistakes, and they stop nothing else. Anyone
 * relying on them should know which of the two they are getting. Making the
 * claim true is a server side check on a route that does not yet exist; until
 * then the comment says what the code does.
 *
 * Amounts are in the STABLECOIN the trade is denominated in, which is the live
 * cash balance. That is the DOLLAR leg of the trade, whichever side it sits on:
 * on a sell the caller must convert, because passing the asset quantity meant a
 * cap of 100 was compared against a count of Bitcoin. Native gas is handled
 * separately by preflightGas.
 */

/**
 * Defaults. Mainnet is materially stricter than testnet: testnet funds are free
 * and exist to be experimented with, mainnet funds are somebody's money.
 */
export const DEFAULT_LIMITS = {
  testnet: {
    perTrade: 1000, // stablecoin units
    perDay: 5000,
    perSession: 2000,
    minNativeFloor: 0.0005, // never spend the last of the gas money
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
  return { ...base, ...(overrides || {}) };
}

// Per-session spend lives in memory only — a session ends when the tab does.
let sessionSpend = 0;
export function sessionSpent() {
  return sessionSpend;
}
export function recordSessionSpend(amount) {
  sessionSpend += Number(amount) || 0;
}
export function resetSessionSpend() {
  sessionSpend = 0;
}

/**
 * Check a proposed trade against every cap.
 *
 * @param {number} amount        stablecoin units being spent
 * @param {number} spentToday    stablecoin units already spent in the last 24h
 * @param {number} impactPct     measured price impact
 * @param {bigint} nativeAfterWei native balance that would remain after gas
 * @returns {{ok:boolean, blocks:string[], warnings:string[], needsExtraConfirm:boolean}}
 */
export function checkTrade({ amount, limits, spentToday = 0, impactPct = 0, nativeAfterWei = null }) {
  const blocks = [];
  const warnings = [];
  const spend = Number(amount) || 0;

  if (spend <= 0) blocks.push("Enter an amount greater than zero.");

  if (spend > limits.perTrade) {
    blocks.push(
      `That is over the ${limits.perTrade} per trade cap. Lower the amount, or raise the cap in Settings.`
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

  // Leaving a wallet with no gas is a soft brick: the tokens are there and
  // nothing can be done with them.
  if (nativeAfterWei !== null) {
    const floorWei = BigInt(Math.round(limits.minNativeFloor * 1e18));
    if (nativeAfterWei < floorWei) {
      blocks.push(
        `This would leave too little native token to pay for another transaction. Keep at least ${limits.minNativeFloor} in reserve, or you will not be able to move these funds afterwards.`
      );
    }
  }

  // Impact does not block outright — a thin pool is a legitimate choice if the
  // user genuinely means it — but it must be acknowledged explicitly.
  const needsExtraConfirm = impactPct > limits.maxPriceImpactPct;
  if (needsExtraConfirm) {
    warnings.push(
      `Price impact is ${impactPct.toFixed(2)}%, above your ${limits.maxPriceImpactPct}% threshold. You would lose roughly that share of the trade's value to the pool's thinness.`
    );
  }

  return { ok: blocks.length === 0, blocks, warnings, needsExtraConfirm };
}
