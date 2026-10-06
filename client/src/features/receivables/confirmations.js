const DEFAULT_CONFIRMATIONS = {
  11155111: 12,
  84532: 5,
  421614: 5,
  11155420: 5,
  80002: 5,

  1: 12,
  8453: 30,
  10: 30,
  42161: 240,
  137: 135,
  56: 135,
  43114: 60,
};

const MIN_CONFIRMATIONS = 1;
const MAX_CONFIRMATIONS = 300;

export function confirmationsFor(chainId, user) {
  const overrides = user && user.crypto && user.crypto.confirmationOverrides;
  if (overrides) {
    const raw = overrides[String(chainId)];
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      return Math.min(MAX_CONFIRMATIONS, Math.max(MIN_CONFIRMATIONS, Math.round(n)));
    }
  }
  const v = DEFAULT_CONFIRMATIONS[Number(chainId)];
  return Number.isFinite(v) ? v : null;
}
