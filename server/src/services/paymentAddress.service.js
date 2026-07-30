const User = require("../models/User");
const Debt = require("../models/Debt");
const PaymentAddress = require("../models/PaymentAddress");
const { getChain } = require("../config/chains");
const { MAX_ADDRESSES_PER_HOUR } = require("../config/derivation");
const { attachTotals } = require("./receivables.service");

const HOUR_MS = 60 * 60 * 1000;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Allocate the next derivation index for a user — ATOMICALLY.
 *
 * `findOneAndUpdate` with `$inc` is a single atomic document operation in Mongo,
 * so two concurrent requests are guaranteed different indices. A read-then-write
 * here would race and hand out the same index twice, which would make it
 * impossible to tell which invoice an incoming payment belonged to. That is
 * unrecoverable, so it is worth doing precisely.
 *
 * @returns {Promise<number>} the index reserved for this caller
 */
async function allocateIndex(userId) {
  const updated = await User.findOneAndUpdate(
    { _id: userId },
    { $inc: { "crypto.nextDerivationIndex": 1 } },
    { new: true, projection: { crypto: 1 } }
  );
  if (!updated) throw httpError(404, "User not found");
  // $inc returns the value AFTER incrementing, so the index we own is one less.
  return updated.crypto.nextDerivationIndex - 1;
}

/**
 * NGN per 1 token. USDC is a US-dollar stablecoin, so this is effectively the
 * USD/NGN rate. Fetched live from the same cached CoinGecko service the rest of
 * the app uses; falls back to a configured rate if the API is unavailable so
 * address generation never hard-fails.
 *
 * @returns {Promise<{rate:number, fetchedAt:Date, stale:boolean}>}
 */
async function getNgnRate() {
  const fallback = Number(process.env.NGN_PER_USD_FALLBACK || 1600);
  try {
    // eslint-disable-next-line global-require
    const { getNgnPrice } = require("./coingecko.service");
    if (typeof getNgnPrice === "function") {
      const row = await getNgnPrice("usd-coin");
      if (row && row.ngn > 0) {
        return { rate: row.ngn, fetchedAt: new Date(), stale: false };
      }
    }
  } catch {
    /* fall through to the configured rate */
  }
  return { rate: fallback, fetchedAt: new Date(), stale: true };
}

/**
 * USDC owed for an NGN balance at a given rate, as a 2-decimal number.
 *
 * ROUNDS UP, deliberately. Rounding to nearest (or down) would under-collect on
 * roughly half of all invoices — the business would quietly lose a fraction of a
 * cent every time and the invoice could never reach zero. Asking for at most one
 * extra cent is the correct trade.
 *
 * 1 USDC is treated as exactly 1 USD, so `ngnPerUsd` is the only rate involved.
 */
function usdcForNgn(ngnAmount, ngnPerUsd) {
  if (!(ngnPerUsd > 0)) throw httpError(500, "Invalid NGN/USD rate");
  const raw = ngnAmount / ngnPerUsd;
  return Math.ceil(raw * 100) / 100;
}

/**
 * Issue a payment address for an invoice.
 *
 * The ADDRESS ITSELF is derived in the browser and posted here — the server
 * never sees a key or a seed. This function owns the index allocation, the rate
 * snapshot and the expiry, and validates that the caller owns the invoice.
 */
async function issueAddress({ userId, debtId, chainId, address, derivationIndex }) {
  const chain = getChain(chainId);
  if (!chain) throw httpError(400, "Unknown or disabled chain");

  const token = (chain.tokens || [])[0];
  if (!token) throw httpError(400, `No stablecoin configured for ${chain.name}`);

  const debt = await Debt.findOne({ _id: debtId, userId });
  if (!debt) throw httpError(404, "Invoice not found");

  // Rate limit: each generation burns a derivation index permanently.
  const recent = await PaymentAddress.countDocuments({
    userId,
    createdAt: { $gte: new Date(Date.now() - HOUR_MS) },
  });
  if (recent >= MAX_ADDRESSES_PER_HOUR) {
    throw httpError(429, "Too many payment addresses generated recently. Try again later.");
  }

  // An invoice may only have one active address at a time — two live addresses
  // would split payments across them and confuse attribution.
  const existing = await PaymentAddress.findOne({ debtId, status: "active" });
  if (existing) {
    throw httpError(409, "This invoice already has an active payment address.");
  }

  // attachTotals takes (userId, debts) — passing only the array silently yields
  // `debts === undefined` and throws inside its .map().
  const [withTotals] = await attachTotals(userId, [debt]);
  const balance = withTotals.balance != null ? withTotals.balance : debt.amount;
  if (balance <= 0) throw httpError(400, "This invoice has nothing outstanding.");

  const { rate, fetchedAt, stale } = await getNgnRate();

  const user = await User.findById(userId).select("crypto");
  const hours = Math.min(720, Math.max(1, (user?.crypto?.expiryHours) || 72));

  const record = await PaymentAddress.create({
    userId,
    debtId,
    chainId: chain.chainId,
    derivationIndex,
    address,
    tokenSymbol: token.symbol,
    tokenContract: token.address,
    tokenDecimals: token.decimals, // provisional; the watcher reads it on chain
    invoiceBalanceNgn: balance,
    expectedUsdc: usdcForNgn(balance, rate),
    ngnPerUsd: rate,
    rateTimestamp: fetchedAt,
    expiresAt: new Date(Date.now() + hours * HOUR_MS),
  });

  debt.history.push({ event: "crypto_address_issued" });
  await debt.save();

  return { paymentAddress: record, chain, rateStale: stale };
}

module.exports = { allocateIndex, issueAddress, getNgnRate, usdcForNgn };
