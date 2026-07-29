/**
 * HD derivation policy for invoice payment addresses.
 *
 * The main wallet lives on the standard Ethereum path m/44'/60'/0'/0/0. Invoice
 * addresses use a DEDICATED branch so they can never collide with it:
 *
 *     m/44' / 60' / 0' / 2 / <index>
 *                        ^
 *                        change-level 2
 *
 * BIP-44 defines change-level 0 as "external/receive" and 1 as "internal/change".
 * No standard wallet derives at level 2, so this branch is ours alone: importing
 * this seed into MetaMask or any other wallet will never surface, spend, or
 * accidentally reuse a receivables address, and our indices can never shadow the
 * user's own accounts.
 *
 * Keep this file in step with client/src/features/wallet/derivation.js — the two
 * must agree exactly or an address will be watched that the user cannot sign for.
 */

const RECEIVABLES_BRANCH = "m/44'/60'/0'/2";

/** Full path for one invoice address. */
function pathForIndex(index) {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid derivation index: ${index}`);
  }
  return `${RECEIVABLES_BRANCH}/${index}`;
}

// Confirmation depth before a payment is trusted enough to settle an invoice.
// Ethereum L1 reorgs a few blocks deep occasionally; L2 testnets settle faster,
// so a smaller depth is appropriate there. Overridable per chain via env.
const DEFAULT_CONFIRMATIONS = {
  11155111: 12, // Ethereum Sepolia
  84532: 5, // Base Sepolia
  421614: 5, // Arbitrum Sepolia
  11155420: 5, // Optimism Sepolia
  80002: 5, // Polygon Amoy
};

function confirmationsFor(chainId) {
  const override = process.env[`CONFIRMATIONS_${chainId}`];
  if (override && !Number.isNaN(Number(override))) return Number(override);
  return DEFAULT_CONFIRMATIONS[Number(chainId)] || 12;
}

// After expiry an address stops being actively watched, but money sent late must
// never vanish silently — it stays under a low-frequency grace watch this long.
const GRACE_DAYS = Number(process.env.PAYMENT_GRACE_DAYS || 30);

// Guard against derivation-index abuse (each generation burns an index forever).
const MAX_ADDRESSES_PER_HOUR = Number(process.env.MAX_PAYMENT_ADDRESSES_PER_HOUR || 20);

module.exports = {
  RECEIVABLES_BRANCH,
  pathForIndex,
  confirmationsFor,
  DEFAULT_CONFIRMATIONS,
  GRACE_DAYS,
  MAX_ADDRESSES_PER_HOUR,
};
