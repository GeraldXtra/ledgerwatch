const User = require("../models/User");
const Debt = require("../models/Debt");
const PaymentAddress = require("../models/PaymentAddress");
const { getChain } = require("../config/chains");
const { MAX_ADDRESSES_PER_HOUR, confirmationsFor } = require("../config/derivation");
const { attachTotals, toleratedShortfallNgn, paidForDebt } = require("./receivables.service");

const HOUR_MS = 60 * 60 * 1000;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function allocateIndex(userId) {
  const updated = await User.findOneAndUpdate(
    { _id: userId },
    { $inc: { "crypto.nextDerivationIndex": 1 } },
    { new: true, projection: { crypto: 1 } }
  );
  if (!updated) throw httpError(404, "User not found");
  return updated.crypto.nextDerivationIndex - 1;
}

async function getNgnRate() {
  const fallback = Number(process.env.NGN_PER_USD_FALLBACK || 1600);
  try {
     
    const { getNgnPrice } = require("./coingecko.service");
    if (typeof getNgnPrice === "function") {
      const row = await getNgnPrice("usd-coin");
      if (row && row.ngn > 0) {
        return {
          rate: row.ngn,
          fetchedAt: new Date(row.fetchedAt || Date.now()),
          stale: Boolean(row.stale),
        };
      }
    }
  } catch {
  }
  console.warn(
    `[paymentAddress] NGN rate unavailable; using the configured fallback of ${fallback}. ` +
      "Any invoice quoted now is fixed at that rate for its whole life."
  );
  return { rate: fallback, fetchedAt: new Date(), stale: true };
}

function usdcForNgn(ngnAmount, ngnPerUsd) {
  if (!(ngnPerUsd > 0)) throw httpError(500, "Invalid NGN/USD rate");
  const raw = ngnAmount / ngnPerUsd;
  return Math.ceil(raw * 100) / 100;
}

function pickStablecoin(chain, symbol) {
  const stables = chain.stables || [];
  if (!stables.length) throw httpError(400, `No stablecoin configured for ${chain.name}`);
  if (!symbol) return stables[0];

  const found = stables.find((t) => t.symbol.toLowerCase() === String(symbol).toLowerCase());
  if (!found) {
    throw httpError(
      400,
      `${symbol} is not available on ${chain.name}. Accepted here: ${stables
        .map((t) => t.symbol)
        .join(", ")}.`
    );
  }
  return found;
}

function stablecoinsFor(chainId) {
  const chain = getChain(chainId);
  if (!chain) return [];
  return (chain.stables || []).map((t) => ({ symbol: t.symbol, name: t.name, decimals: t.decimals }));
}

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

async function issueAddress({ userId, debtId, chainId, address, derivationIndex, tokenSymbol }) {
  const chain = getChain(chainId);
  if (!chain) throw httpError(400, "Unknown or disabled chain");

  const token = pickStablecoin(chain, tokenSymbol);

  const debt = await Debt.findOne({ _id: debtId, userId });
  if (!debt) throw httpError(404, "Invoice not found");

  const recent = await PaymentAddress.countDocuments({
    userId,
    createdAt: { $gte: new Date(Date.now() - HOUR_MS) },
  });
  if (recent >= MAX_ADDRESSES_PER_HOUR) {
    throw httpError(429, "Too many payment addresses generated recently. Try again later.");
  }

  const existing = await PaymentAddress.findOne({ debtId, status: "active" });
  if (existing) {
    throw httpError(409, "This invoice already has an active payment address.");
  }

  const [withTotals] = await attachTotals(userId, [debt]);
  const balance = withTotals.balance != null ? withTotals.balance : debt.amount;
  if (balance <= 0) throw httpError(400, "This invoice has nothing outstanding.");

  const { rate, fetchedAt, stale } = await getNgnRate();

  const user = await User.findById(userId).select("crypto");
  const hours = Math.min(720, Math.max(1, (user?.crypto?.expiryHours) || 72));

  let decimals = token.decimals;
  try {
     
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

  let record;
  try {
    record = await PaymentAddress.create({
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
      rateIsFallback: Boolean(stale),

      quote: {
        invoiceBalanceNgn: balance,
        expectedUsdc: usdcForNgn(balance, rate),
        ngnPerUsd: rate,
        rateTimestamp: fetchedAt,
        rateIsFallback: Boolean(stale),
        issuedAt: new Date(),
        reconstructed: false,
      },

      expiresAt: new Date(Date.now() + hours * HOUR_MS),
    });
  } catch (err) {
    if (err && err.code === 11000) {
      const keys = Object.keys((err && err.keyPattern) || {});
      console.warn(
        `[paymentAddress] issue for invoice ${debtId} refused by a unique index on ` +
          `${keys.join(",") || "an unknown key"}; nothing was written.`
      );
      if (keys.includes("debtId")) {
        throw httpError(409, "This invoice already has an active payment address.");
      }
      if (keys.includes("address")) {
        throw httpError(409, "That address is already issued against another invoice.");
      }
      throw httpError(409, "That derivation index has already been used. Try again.");
    }
    throw err;
  }

  debt.history.push({ event: "crypto_address_issued" });
  await debt.save();

  return { paymentAddress: record, chain, rateStale: stale };
}

const TOLERANCE = Number(process.env.USDC_SETTLEMENT_TOLERANCE || 0.005);

async function resyncActivePaymentAddress(debtId) {
  try {
     
    const PaymentAddress = require("../models/PaymentAddress");
     
    const Debt = require("../models/Debt");

    const pa = await PaymentAddress.findOne({ debtId, status: "active" });
    if (!pa) return { updated: false };

    const debt = await Debt.findById(debtId);
    if (!debt) return { updated: false };

    const paid = await paidForDebt(pa.debtId);
    const remainingNgn = Math.max(0, (debt.amount || 0) - paid);

    if (remainingNgn <= toleratedShortfallNgn(debt.amount) || remainingNgn <= 0) {
      pa.expectedUsdc = 0;
      pa.status = "paid";
      await pa.save();
      return { updated: true, expectedUsdc: 0, remainingNgn: 0, closed: true };
    }

    const expectedUsdc = usdcForNgn(remainingNgn, pa.ngnPerUsd);
    if (expectedUsdc === pa.expectedUsdc) return { updated: false, expectedUsdc, remainingNgn };

    const quotedBefore = pa.quote ? pa.quote.expectedUsdc : undefined;

    pa.expectedUsdc = expectedUsdc;
    pa.invoiceBalanceNgn = remainingNgn;
    await pa.save();

    if (pa.quote && pa.quote.expectedUsdc !== quotedBefore) {
      console.error(
        `[paymentAddress] INVARIANT BROKEN on ${pa.address}: the issuance quote changed during a ` +
          `resync (${quotedBefore} -> ${pa.quote.expectedUsdc}). ARCHITECTURE.md invariant 6 says ` +
          "quote.* is immutable after issuance. This is LW-005 returning."
      );
    }
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
