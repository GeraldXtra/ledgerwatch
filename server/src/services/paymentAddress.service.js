const User = require("../models/User");
const Debt = require("../models/Debt");
const PaymentAddress = require("../models/PaymentAddress");
const { getChain } = require("../config/chains");
const { MAX_ADDRESSES_PER_HOUR, confirmationsFor } = require("../config/derivation");
const { attachTotals, toleratedShortfallNgn } = require("./receivables.service");

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
        // fetchedAt is when CoinGecko was actually read, which may be minutes
        // ago on a cache hit. The invoice UI shows this age to the user, so it
        // must not be overwritten with "now".
        return {
          rate: row.ngn,
          fetchedAt: new Date(row.fetchedAt || Date.now()),
          stale: Boolean(row.stale),
        };
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
 * Which stablecoin this address will accept.
 *
 * FROM `chain.stables`, NEVER `chain.tokens`. `tokens` also carries the wrapped
 * native (WETH), and offering that as an invoice currency would be wrong twice
 * over: it is volatile, and every naira conversion here treats one token as
 * exactly one US dollar. An invoice quoted in WETH at a 1:1 USD rate would be
 * off by a factor of thousands.
 *
 * No symbol given means the chain's first stablecoin, so existing callers keep
 * working unchanged.
 *
 * On the currently enabled TESTNETS this offers USDC alone, because Tether has
 * never deployed an official USDT to any of them — the registry records that
 * explicitly. Inventing an address to make a second option appear would risk
 * sending real money somewhere unrecoverable, so the list stays honest and
 * simply grows on its own when chains with a verified USDT are enabled.
 */
function pickStablecoin(chain, symbol) {
  const stables = chain.stables || [];
  if (!stables.length) throw httpError(400, `No stablecoin configured for ${chain.name}`);
  if (!symbol) return stables[0];

  const found = stables.find((t) => t.symbol.toLowerCase() === String(symbol).toLowerCase());
  if (!found) {
    // Names what IS available rather than failing blankly.
    throw httpError(
      400,
      `${symbol} is not available on ${chain.name}. Accepted here: ${stables
        .map((t) => t.symbol)
        .join(", ")}.`
    );
  }
  return found;
}

/** The stablecoins an invoice can be issued in, for a chain. */
function stablecoinsFor(chainId) {
  const chain = getChain(chainId);
  if (!chain) return [];
  return (chain.stables || []).map((t) => ({ symbol: t.symbol, name: t.name, decimals: t.decimals }));
}

/**
 * Read-only preview of what issuing an address would ask for.
 *
 * Exists so the confirmation screen can show the real balance, USDC amount, rate
 * and rate AGE before the user commits. The alternative — calling /allocate to
 * get those figures — would burn a derivation index every time somebody merely
 * opened the dialog and changed their mind. Indices are monotonic and never
 * reused, so that waste is permanent.
 *
 * Deliberately does not reserve anything and does not write.
 */
async function quoteForInvoice({ userId, debtId, chainId, tokenSymbol }) {
  const chain = getChain(chainId);
  if (!chain) throw httpError(400, "Unknown or disabled chain");

  const token = pickStablecoin(chain, tokenSymbol);

  const debt = await Debt.findOne({ _id: debtId, userId });
  if (!debt) throw httpError(404, "Invoice not found");

  const [withTotals] = await attachTotals(userId, [debt]);
  const balance = withTotals.balance != null ? withTotals.balance : debt.amount;

  const { rate, fetchedAt, stale } = await getNgnRate();
  const user = await User.findById(userId).select("crypto");
  const expiryHours = Math.min(720, Math.max(1, user?.crypto?.expiryHours || 72));

  const active = await PaymentAddress.findOne({ debtId, status: "active" });

  return {
    balanceNgn: balance,
    // A fully paid invoice has nothing to quote; the caller shows why rather
    // than dividing zero by a rate and offering an address for 0 USDC.
    expectedUsdc: balance > 0 ? usdcForNgn(balance, rate) : 0,
    ngnPerUsd: rate,
    rateTimestamp: fetchedAt,
    rateStale: stale,
    expiryHours,
    confirmations: confirmationsFor(chain.chainId),
    token,
    hasActiveAddress: Boolean(active),
  };
}

/**
 * Issue a payment address for an invoice.
 *
 * The ADDRESS ITSELF is derived in the browser and posted here — the server
 * never sees a key or a seed. This function owns the index allocation, the rate
 * snapshot and the expiry, and validates that the caller owns the invoice.
 */
async function issueAddress({ userId, debtId, chainId, address, derivationIndex, tokenSymbol }) {
  const chain = getChain(chainId);
  if (!chain) throw httpError(400, "Unknown or disabled chain");

  const token = pickStablecoin(chain, tokenSymbol);

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

  /**
   * DECIMALS READ FROM THE CONTRACT, not trusted from config.
   *
   * The same symbol carries different decimals on different chains — USDC is 6
   * almost everywhere but 18 on BNB Chain, and USDT likewise. Getting it wrong
   * misreads every amount by a factor of 10^12, which is the classic and very
   * expensive version of this bug. Falls back to the configured value if the
   * call fails, and the watcher re-reads it on every scan regardless.
   */
  let decimals = token.decimals;
  try {
    // eslint-disable-next-line global-require
    const { rpcCall } = require("./rpc.service");
    const res = await rpcCall(chain, "eth_call", [{ to: token.address, data: "0x313ce567" }, "latest"]);
    if (res && res !== "0x") {
      const onChain = parseInt(res, 16);
      if (Number.isInteger(onChain) && onChain >= 0 && onChain <= 36) {
        if (onChain !== token.decimals) {
          console.warn(
            `[paymentAddress] ${token.symbol} on ${chain.name} reports ${onChain} decimals, ` +
              `config says ${token.decimals}. Using the contract.`
          );
        }
        decimals = onChain;
      }
    }
  } catch (err) {
    console.warn(`[paymentAddress] could not read ${token.symbol} decimals: ${err.message}`);
  }

  const record = await PaymentAddress.create({
    userId,
    debtId,
    chainId: chain.chainId,
    derivationIndex,
    address,
    tokenSymbol: token.symbol,
    tokenContract: token.address,
    tokenDecimals: decimals,
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

/**
 * Settlement tolerance, shared with the watch pass. A payer within this fraction
 * of the asked amount has paid in full; it absorbs rounding and fee dust.
 */
const TOLERANCE = Number(process.env.USDC_SETTLEMENT_TOLERANCE || 0.005);

/**
 * RESTATE WHAT AN ACTIVE PAYMENT ADDRESS IS STILL ASKING FOR.
 *
 * Call this after ANY change to what an invoice owes — a bank payment recorded,
 * a payment deleted, an invoice force-marked paid, or a crypto part-payment.
 *
 * WHY THIS EXISTS
 * ---------------
 * The address stores `expectedUsdc`, computed when it was issued. Only the crypto
 * settlement path ever updated it. So an invoice for ₦100,000 quoting 60 USDC
 * still quoted 60 USDC after ₦50,000 arrived by bank transfer — the debtor would
 * pay roughly double, and `fullyPaid` was being decided against that stale
 * figure. It also made the reminder look stale: the reminder body recomposes
 * correctly every time, but the crypto amount inside it is read from here.
 *
 * THE RATE NEVER MOVES
 * --------------------
 * Recomputed at the address's OWN stored `ngnPerUsd` snapshot, never a live rate.
 * The payer was quoted at that rate; requoting them as the naira moves would mean
 * someone who paid exactly what was asked could still be shown as owing money.
 *
 * Never throws — the ledger is already correct by the time this runs, and a
 * failure to restate a quote must not undo a recorded payment.
 *
 * @returns {Promise<{updated:boolean, expectedUsdc?:number, remainingNgn?:number, closed?:boolean}>}
 */
async function resyncActivePaymentAddress(debtId) {
  try {
    // eslint-disable-next-line global-require
    const PaymentAddress = require("../models/PaymentAddress");
    // eslint-disable-next-line global-require
    const Payment = require("../models/Payment");
    // eslint-disable-next-line global-require
    const Debt = require("../models/Debt");

    const pa = await PaymentAddress.findOne({ debtId, status: "active" });
    if (!pa) return { updated: false };

    const debt = await Debt.findById(debtId);
    if (!debt) return { updated: false };

    // COMBINED total across every method — bank, cash, crypto, manual. The whole
    // point is that one method's payment changes what the other must ask for.
    const rows = await Payment.aggregate([
      { $match: { debtId: pa.debtId } },
      { $group: { _id: null, paid: { $sum: "$amount" } } },
    ]);
    const paid = rows.length ? rows[0].paid : 0;
    const remainingNgn = Math.max(0, (debt.amount || 0) - paid);

    /**
     * Settled within tolerance: stop quoting entirely rather than asking for a
     * few kobo. Marked `paid` so the watcher stops scanning it and the UI stops
     * showing an amount due.
     *
     * THE TOLERANCE IS THE SHARED ONE, and it is capped in absolute terms. This
     * line read `remainingNgn <= debt.amount * TOLERANCE`, which on a 326 million
     * naira invoice closed the address while 1.6 million was still genuinely
     * owed, set expectedUsdc to 0, and stopped the watcher scanning it. Of the
     * three copies of this rule this was the worst, because it makes the invoice
     * stop ASKING for money it is still owed.
     */
    if (remainingNgn <= toleratedShortfallNgn(debt.amount) || remainingNgn <= 0) {
      pa.expectedUsdc = 0;
      pa.status = "paid";
      await pa.save();
      return { updated: true, expectedUsdc: 0, remainingNgn: 0, closed: true };
    }

    const expectedUsdc = usdcForNgn(remainingNgn, pa.ngnPerUsd);
    if (expectedUsdc === pa.expectedUsdc) return { updated: false, expectedUsdc, remainingNgn };

    pa.expectedUsdc = expectedUsdc;
    pa.invoiceBalanceNgn = remainingNgn;
    await pa.save();
    return { updated: true, expectedUsdc, remainingNgn, closed: false };
  } catch (err) {
    console.error("[paymentAddress] resync failed:", err.message);
    return { updated: false };
  }
}

module.exports = {
  allocateIndex,
  issueAddress,
  getNgnRate,
  usdcForNgn,
  quoteForInvoice,
  resyncActivePaymentAddress,
  pickStablecoin,
  stablecoinsFor,
  TOLERANCE,
};
