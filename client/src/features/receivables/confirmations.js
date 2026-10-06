/**
 * How deep a transfer must be before the server settles the invoice.
 *
 * THIS PANEL USED TO INVENT THE NUMBER. `confirmationsNeeded` in
 * CryptoPaymentPanel was two lines: 12 for Ethereum Sepolia, 12 for any
 * mainnet, 5 otherwise. The server waits 240 on Arbitrum One, 135 on Polygon
 * and BNB Chain and 30 on Base and OP Mainnet, so on the chains where the money
 * is real the panel understated the wait by up to twentyfold. A payer's
 * transfer reached "12 of 12" and then sat there, apparently stuck, for another
 * two hundred blocks while the owner watched a working system look broken
 * (LW-041).
 *
 * Mirrors DEFAULT_CONFIRMATIONS in server/src/config/derivation.js and the
 * override clamp in server/src/services/cryptoSettings.service.js, which is the
 * same pair CryptoSection.jsx mirrors for the Settings screen. The server is the
 * authority and does not publish the depth on the payment-address list yet, so
 * this copy is kept in step by hand: change one, change all three.
 */
const DEFAULT_CONFIRMATIONS = {
  // ---- testnets: free money, shallow depths are fine ----
  11155111: 12, // Ethereum Sepolia
  84532: 5, // Base Sepolia
  421614: 5, // Arbitrum Sepolia
  11155420: 5, // Optimism Sepolia
  80002: 5, // Polygon Amoy

  // ---- mainnets: real money, depths from measured block times ----
  1: 12, // Ethereum
  8453: 30, // Base
  10: 30, // OP Mainnet
  42161: 240, // Arbitrum One
  137: 135, // Polygon
  56: 135, // BNB Chain, at the measured 0.45s block
  43114: 60, // Avalanche C-Chain
};

// The same bounds `confirmationsFor` applies on the server. An override outside
// them is clamped there, so showing the raw number here would state a depth the
// watcher does not use.
const MIN_CONFIRMATIONS = 1;
const MAX_CONFIRMATIONS = 300;

/**
 * The depth the watcher will actually wait for on `chainId`, for this user.
 *
 * Returns null when the chain is not in the table. An unknown chain is not given
 * a made up 12: an unknown mainnet is far likelier to be deeper than shallower,
 * so inventing a number would understate the wait in the direction that makes a
 * healthy payment look stalled. The caller says "we do not know" instead.
 */
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
