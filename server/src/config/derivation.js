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
 * finality is weaker in practice. BLOCK TIMES ARE MEASURED (20,000 block
 * timestamp deltas, 2026-09-02), because three of the original depths were
 * derived from block times that no longer exist: BNB was written as 3s and is
 * 0.45s, so "20 blocks = 60s" was in fact nine seconds on a 21 validator chain.
 *
 *   Ethereum    12 x 12.04s  = 144s   L1 reorgs are shallow but slow to settle
 *   Base        30 x 2.00s   = 60s    OP stack, follows L1 for hard finality
 *   OP Mainnet  30 x 2.00s   = 60s    same
 *   Arbitrum   240 x 0.25s   = 60s    blocks are very fast, so the count is high
 *   Polygon    135 x 1.50s   = 202s   deliberately the most conservative: Polygon
 *                                     has had materially deeper reorgs than its
 *                                     block time suggests
 *   BNB        135 x 0.45s   = 61s    was 20, which was nine seconds
 *   Avalanche   60 x 1.05s   = 63s    fast finality, but not free
 *
 * Every one is overridable per chain with CONFIRMATIONS_<chainId>. Raise them
 * rather than lower them: waiting longer costs a customer some patience, and
 * settling too early costs the owner the invoice.
 */

/**
 * Seconds per block, measured. Used to turn "minutes of chain time" into a
 * block count for the grace scan, and nowhere else. A chain missing here gets
 * a conservative two seconds, which over scans rather than under scans.
 */
const BLOCK_TIME_SEC = {
  11155111: 12, // Ethereum Sepolia
  84532: 2, // Base Sepolia
  421614: 0.25, // Arbitrum Sepolia
  11155420: 2, // Optimism Sepolia
  80002: 2, // Polygon Amoy
  1: 12.04,
  8453: 2.0,
  10: 2.0,
  42161: 0.25,
  137: 1.5,
  56: 0.45,
  43114: 1.05,
};

function blockTimeFor(chainId) {
  const t = BLOCK_TIME_SEC[Number(chainId)];
  return Number.isFinite(t) && t > 0 ? t : 2;
}

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
  137: 135, // Polygon: ~202s at the measured 1.5s block
  56: 135, // BNB Chain: ~61s at the measured 0.45s block. Was 20, which was 9s.
  43114: 60, // Avalanche C-Chain: ~63s at the measured 1.05s block
};

/**
 * The floor a CONFIRMATIONS_<chainId> override may not go below.
 *
 * The guard here used to be `if (override && !Number.isNaN(Number(override)))`,
 * which accepts 0 — the string "0" is truthy and Number("0") is not NaN — and
 * accepts negatives, and accepts a value that is nothing but whitespace, since
 * Number(" ") is 0. A depth of zero means an invoice is marked paid, a receipt
 * is emailed and reminders are cancelled on a transfer with no confirmations at
 * all, which on a mainnet can still be reorganised out of existence. The
 * user-facing override path in cryptoSettings.service has clamped to [1, 300]
 * all along; this path, which is the one a deployment actually uses, clamped
 * nothing. A bad value is now refused, said out loud once, and the measured
 * default is used instead — never a shallower depth than the default.
 */
const MIN_ENV_CONFIRMATIONS = 1;
const MAX_ENV_CONFIRMATIONS = 300;
const warnedConfirmations = new Set();

function confirmationsFor(chainId) {
  const fallback = DEFAULT_CONFIRMATIONS[Number(chainId)] || 12;
  const raw = process.env[`CONFIRMATIONS_${chainId}`];
  if (raw === undefined || String(raw).trim() === "") return fallback;

  const n = Number(raw);
  if (!Number.isFinite(n) || n < MIN_ENV_CONFIRMATIONS || n > MAX_ENV_CONFIRMATIONS) {
    if (!warnedConfirmations.has(String(chainId))) {
      warnedConfirmations.add(String(chainId));
      console.error(
        `CONFIRMATIONS_${chainId} is "${raw}", which is not a depth between ` +
          `${MIN_ENV_CONFIRMATIONS} and ${MAX_ENV_CONFIRMATIONS}. Ignoring it and using the ` +
          `measured default of ${fallback} blocks. Settling an invoice at zero confirmations ` +
          `would credit money a reorg can still remove.`
      );
    }
    return fallback;
  }
  return Math.round(n);
}

/**
 * A MISTYPED NUMBER MUST NOT REMOVE A GUARD.
 *
 * These three were `Number(process.env.X || default)` with nothing after it, so
 * a stray letter or a unit ("20/hr") made them NaN and every comparison against
 * them then read false. The address cap is the dangerous one: `recent >= NaN`
 * is always false, so the limit that stops an account burning through
 * derivation indices was switched off entirely, silently. `GRACE_DAYS` as NaN
 * produces an Invalid Date and the grace query then matches nothing, which
 * stops late payments being found at all.
 *
 * index.js already refuses to boot on a bad JWT_SECRET; the same instinct
 * applies here, except that these have a safe default to fall back to, so the
 * value is refused loudly rather than the process being killed.
 */
function positiveEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(
      `${name} is "${raw}", which is not a positive number. Using ${fallback} instead. ` +
        `Left as it was, this would have disabled the guard it configures rather than tightening it.`
    );
    return fallback;
  }
  return n;
}

// After expiry an address stops being actively watched, but money sent late must
// never vanish silently — it stays under a low-frequency grace watch this long.
const GRACE_DAYS = positiveEnvNumber("PAYMENT_GRACE_DAYS", 30);

// How often a single expired address is re-checked during that grace window.
// The active pass runs every minute; re-scanning every expired address that often
// for 30 days would be a large, pointless RPC bill, since late payments are rare
// and not urgent. One cheap balance check an hour is plenty.
const GRACE_SCAN_MINUTES = positiveEnvNumber("PAYMENT_GRACE_SCAN_MINUTES", 60);

// Guard against derivation-index abuse (each generation burns an index forever).
const MAX_ADDRESSES_PER_HOUR = positiveEnvNumber("MAX_PAYMENT_ADDRESSES_PER_HOUR", 20);

module.exports = {
  RECEIVABLES_BRANCH,
  pathForIndex,
  blockTimeFor,
  confirmationsFor,
  DEFAULT_CONFIRMATIONS,
  GRACE_DAYS,
  GRACE_SCAN_MINUTES,
  MAX_ADDRESSES_PER_HOUR,
};
