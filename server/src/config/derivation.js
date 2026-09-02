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
/**
 * Confirmation depth before a payment is trusted enough to settle an invoice.
 *
 * TESTNET AND MAINNET ARE NOT THE SAME PROBLEM. On a testnet a wrong depth costs
 * nothing: the funds are free and a reorg that unsettles an invoice is an
 * inconvenience. On mainnet the same reorg means an invoice was marked paid, a
 * receipt was sent, reminders were cancelled, and the money then ceased to exist.
 *
 * The mainnet numbers below are chosen for roughly a minute or more of chain
 * time, which is the window ordinary reorgs live in, and more where a chain's
 * finality is weaker in practice:
 *
 *   Ethereum    12 x 12s   = 144s   L1 reorgs are shallow but slow to settle
 *   Base        30 x 2s    = 60s    OP stack, follows L1 for hard finality
 *   OP Mainnet  30 x 2s    = 60s    same
 *   Arbitrum   240 x 0.25s = 60s    blocks are very fast, so the count is high
 *   Polygon    100 x 2s    = 200s   deliberately the most conservative: Polygon
 *                                   has had materially deeper reorgs than its
 *                                   block time suggests
 *   BNB         20 x 3s    = 60s
 *   Avalanche   30 x 2s    = 60s    fast finality, but not free
 *
 * Every one is overridable per chain with CONFIRMATIONS_<chainId>. Raise them
 * rather than lower them: waiting longer costs a customer some patience, and
 * settling too early costs the owner the invoice.
 */
const DEFAULT_CONFIRMATIONS = {
  // ---- testnets: free money, shallow depths are fine ----
  11155111: 12, // Ethereum Sepolia
  84532: 5, // Base Sepolia
  421614: 5, // Arbitrum Sepolia
  11155420: 5, // Optimism Sepolia
  80002: 5, // Polygon Amoy

  // ---- mainnets: real money ----
  1: 12, // Ethereum
  8453: 30, // Base
  10: 30, // OP Mainnet
  42161: 240, // Arbitrum One
  137: 100, // Polygon
  56: 20, // BNB Chain
  43114: 30, // Avalanche C-Chain
};

function confirmationsFor(chainId) {
  const override = process.env[`CONFIRMATIONS_${chainId}`];
  if (override && !Number.isNaN(Number(override))) return Number(override);
  return DEFAULT_CONFIRMATIONS[Number(chainId)] || 12;
}

// After expiry an address stops being actively watched, but money sent late must
// never vanish silently — it stays under a low-frequency grace watch this long.
const GRACE_DAYS = Number(process.env.PAYMENT_GRACE_DAYS || 30);

// How often a single expired address is re-checked during that grace window.
// The active pass runs every minute; re-scanning every expired address that often
// for 30 days would be a large, pointless RPC bill, since late payments are rare
// and not urgent. One cheap balance check an hour is plenty.
const GRACE_SCAN_MINUTES = Number(process.env.PAYMENT_GRACE_SCAN_MINUTES || 60);

// Guard against derivation-index abuse (each generation burns an index forever).
const MAX_ADDRESSES_PER_HOUR = Number(process.env.MAX_PAYMENT_ADDRESSES_PER_HOUR || 20);

module.exports = {
  RECEIVABLES_BRANCH,
  pathForIndex,
  confirmationsFor,
  DEFAULT_CONFIRMATIONS,
  GRACE_DAYS,
  GRACE_SCAN_MINUTES,
  MAX_ADDRESSES_PER_HOUR,
};
