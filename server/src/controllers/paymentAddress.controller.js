const PaymentAddress = require("../models/PaymentAddress");
const Debt = require("../models/Debt");
const { getChain, listChains } = require("../config/chains");
const {
  confirmationsFor,
  requireCryptoEnabled,
} = require("../services/cryptoSettings.service");
const {
  allocateIndex,
  issueAddress,
  getNgnRate,
  quoteForInvoice,
  stablecoinsFor,
} = require("../services/paymentAddress.service");
// The same balance read and the same dust tolerance the watcher uses, so
// "empty" means one thing in this codebase rather than two.
const { tokenBalance, TOLERANCE } = require("../services/paymentWatch.service");

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
// A Mongo ObjectId as it arrives in a query string.
const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

/**
 * `?debtId=` COERCED AND SHAPE CHECKED BEFORE IT REACHES A QUERY (LW-074).
 *
 * LW-074 went through nine routes doing this and missed the two in this file.
 * Express parses `?debtId[$ne]=x` into an OBJECT, so the value went into the
 * find filter as a query operator rather than an id, and anything that was not
 * a valid id threw a CastError that surfaced as a 500 — an outage message for
 * a malformed request. Neither crossed between accounts, because every query
 * here is anchored on `userId`, but this is the file that issues addresses
 * money is sent to and it should be the strictest, not the last.
 *
 * @returns {string|null|false} the id, null when absent, false when unusable
 */
function readDebtId(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return false;
  return OBJECT_ID_RE.test(value) ? value : false;
}

/**
 * GET /api/payment-addresses/quote?debtId=&chainId=
 *
 * What issuing an address WOULD ask for, without reserving anything. The
 * confirmation screen needs the balance, USDC amount, rate and rate age up
 * front; using /allocate for that would consume a derivation index every time a
 * dialog was opened and abandoned.
 */
async function quote(req, res) {
  try {
    requireCryptoEnabled(req.user);
    const chainId = Number(req.query.chainId);
    const debtId = readDebtId(req.query.debtId);
    /**
     * ABSENT IS ALSO REFUSED HERE, and it is not the same as refusing a bad id.
     * Mongoose STRIPS an undefined value from a filter, so `?debtId=` missing
     * became `Debt.findOne({ userId })` and quoted whichever invoice happened to
     * come back first — a real amount, for the wrong invoice, on a screen whose
     * next button issues an address for it.
     */
    if (debtId === false || debtId === null) {
      return res.status(400).json({ error: "A valid invoice id is required to quote an address" });
    }
    const result = await quoteForInvoice({
      userId: req.user._id,
      debtId,
      chainId,
      // Optional. Absent means the chain's first stablecoin, so the existing
      // client keeps working without change.
      tokenSymbol: req.query.tokenSymbol,
    });
    // Every stablecoin this chain can actually accept, so the UI can offer the
    // real choice rather than a hardcoded one. Testnets list USDC alone because
    // no verified USDT exists there — that is honest, not a gap.
    return res.json({ ...result, availableTokens: stablecoinsFor(chainId) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("payment address quote error:", err.message);
    return res.status(500).json({ error: "Failed to quote this invoice" });
  }
}

/**
 * POST /api/payment-addresses/allocate  { chainId }
 *
 * Step 1 of a two-step issue. Reserves the next derivation index atomically and
 * returns it plus the chain/token context. The client then derives the address
 * for that index IN THE BROWSER and posts it back to /issue. The server never
 * sees a key or a seed at any point.
 */
async function allocate(req, res) {
  try {
    // Checked BEFORE an index is reserved: allocation permanently consumes one,
    // so a disabled account must be turned away before it burns anything.
    requireCryptoEnabled(req.user);

    const chainId = Number(req.body && req.body.chainId);
    const chain = getChain(chainId);
    if (!chain) return res.status(400).json({ error: "Unknown or disabled chain" });

    const token = (chain.tokens || [])[0];
    if (!token) {
      return res.status(400).json({ error: `No stablecoin configured for ${chain.name}` });
    }

    const derivationIndex = await allocateIndex(req.user._id);
    const rate = await getNgnRate();

    return res.json({
      derivationIndex,
      chain: {
        chainId: chain.chainId,
        name: chain.name,
        explorer: chain.explorer,
        testnet: chain.testnet,
      },
      token,
      // The user's own depth if they set one, otherwise the per-chain default.
      confirmations: confirmationsFor(chain.chainId, req.user),
      rate: { ngnPerToken: rate.rate, fetchedAt: rate.fetchedAt, stale: rate.stale },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("allocate index error:", err.message);
    return res.status(500).json({ error: "Failed to allocate a payment address" });
  }
}

/**
 * POST /api/payment-addresses  { debtId, chainId, address, derivationIndex }
 * Step 2: record the browser-derived address against the invoice.
 */
async function create(req, res) {
  try {
    requireCryptoEnabled(req.user);
    const { debtId, chainId, address, derivationIndex, tokenSymbol } = req.body || {};
    if (!ADDRESS_RE.test(address || "")) {
      return res.status(400).json({ error: "Invalid address" });
    }
    if (!Number.isInteger(derivationIndex) || derivationIndex < 0) {
      return res.status(400).json({ error: "Invalid derivation index" });
    }

    const result = await issueAddress({
      userId: req.user._id,
      debtId,
      chainId: Number(chainId),
      address,
      derivationIndex,
      // Which stablecoin the payer will send. Validated against the chain's
      // verified list in the service, which rejects anything else by name.
      tokenSymbol,
    });

    return res.status(201).json({
      paymentAddress: result.paymentAddress,
      chain: result.chain,
      rateStale: result.rateStale,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    // A duplicate key means one of the unique guards caught something that must
    // never happen. Surface it loudly rather than letting two invoices share an
    // address, and name which guard fired — they mean different things.
    if (err.code === 11000) {
      const onAddress = /address/.test(err.message || "") && !/derivationIndex/.test(err.message || "");
      return res.status(409).json({
        error: onAddress
          ? "That address is already in use by another invoice. This happens if the same recovery phrase is used by more than one account; use a separate wallet for each."
          : "That derivation index is already in use. Please try again.",
      });
    }
    console.error("create payment address error:", err.message);
    return res.status(500).json({ error: "Failed to create the payment address" });
  }
}

/** How much of what arrived at an address is still sitting there, per our own records. */
function unsweptAt(pa) {
  const decimals = pa.tokenDecimals || 6;
  const seen = (pa.observed || [])
    .filter((o) => o.status === "confirmed")
    .reduce((sum, o) => sum + Number(o.value || 0) / 10 ** decimals, 0);
  const swept = (pa.sweeps || []).reduce((sum, s) => sum + (Number(s.amountUsdc) || 0), 0);
  // One unit at the token's own precision, so floating-point noise in the
  // division above cannot register as a balance.
  return seen - swept > 1 / 10 ** decimals ? seen - swept : 0;
}

// How many rows the newest-first page carries. Anything older is only included
// when it is still holding money — see below.
const PAGE_SIZE = 100;
const HOLDING_SCAN = 500;

// GET /api/payment-addresses?debtId=  -> addresses for an invoice (or all).
async function list(req, res) {
  try {
    const query = { userId: req.user._id };
    const debtId = readDebtId(req.query.debtId);
    if (debtId === false) return res.status(400).json({ error: "That is not a valid invoice id" });
    if (debtId) query.debtId = debtId;

    /**
     * THE OLDEST ADDRESSES ARE THE ONES MOST LIKELY TO STILL HOLD MONEY, AND
     * THEY WERE THE ONES BEING DROPPED.
     *
     * This returned the newest hundred and said nothing about having cut the
     * list short. The Collected screen, which is where sweeping happens, renders
     * whatever comes back and has no page two. So the moment a business issued
     * its hundred and first address the oldest fell off that screen forever —
     * and an old address is old precisely because nobody got round to sweeping
     * it. The owner read a complete looking screen and concluded there was
     * nothing left to collect. That is the same class of lie as a silent early
     * return, in the one place in the product where the lie is about money.
     *
     * So the page is still the newest hundred, and then EVERY address outside it
     * that our own records say is still holding a confirmed, unswept balance is
     * added back regardless of age. `total` and `truncated` are reported
     * alongside, so the client can say what it is not showing rather than
     * implying it is showing everything.
     */
    const page = await PaymentAddress.find(query).sort({ createdAt: -1 }).limit(PAGE_SIZE);
    const total = await PaymentAddress.countDocuments(query);

    let addresses = page;
    let holdingBeyondPage = 0;
    if (total > page.length) {
      const seen = new Set(page.map((a) => String(a._id)));
      const older = await PaymentAddress.find({
        ...query,
        _id: { $nin: page.map((a) => a._id) },
        // Only rows that ever received anything can be holding anything.
        "observed.0": { $exists: true },
      })
        .sort({ createdAt: -1 })
        .limit(HOLDING_SCAN);

      const holding = older.filter((pa) => !seen.has(String(pa._id)) && unsweptAt(pa) > 0);
      holdingBeyondPage = holding.length;
      addresses = [...page, ...holding];
    }

    // Attach the debtor name as a SEPARATE field rather than populating `debtId`.
    // The sweep list needs to say which client an address belongs to, and
    // populating would turn debtId from an id into an object for every existing
    // caller.
    const debts = await Debt.find({
      _id: { $in: addresses.map((a) => a.debtId) },
      userId: req.user._id,
    }).select("debtorName");
    const nameById = new Map(debts.map((d) => [String(d._id), d.debtorName]));

    const rows = addresses.map((a) => ({
      ...a.toObject(),
      debtorName: nameById.get(String(a.debtId)) || null,
    }));

    /**
     * The CURRENT rate alongside each address's SNAPSHOT rate.
     *
     * The snapshot is what settles the invoice — a payer who sends exactly what
     * they were quoted clears it however the naira has moved since. But the owner
     * needs to see the divergence, because a snapshot taken days ago may now be
     * worth materially more or less in naira than the invoice says. Showing only
     * one number hides that; showing both makes it a decision rather than a
     * surprise.
     */
    const live = await getNgnRate();
    return res.json({
      addresses: rows,
      // What the list is NOT showing. `truncated` is true whenever rows were
      // left out; every one of them is an address our records say is empty,
      // because anything still holding money was pulled back in above.
      total,
      truncated: rows.length < total,
      holdingBeyondPage,
      chains: listChains(),
      currentRate: {
        ngnPerUsd: live.rate,
        fetchedAt: live.fetchedAt,
        stale: live.stale,
      },
    });
  } catch (err) {
    console.error("list payment addresses error:", err.message);
    return res.status(500).json({ error: "Failed to load payment addresses" });
  }
}

// PATCH /api/payment-addresses/:id/revoke -> stop watching early.
async function revoke(req, res) {
  try {
    const record = await PaymentAddress.findOne({ _id: req.params.id, userId: req.user._id });
    if (!record) return res.status(404).json({ error: "Payment address not found" });
    if (record.status !== "active") {
      return res.status(409).json({ error: `Address is already ${record.status}` });
    }
    record.status = "revoked";
    await record.save();
    return res.json({ paymentAddress: record });
  } catch (err) {
    console.error("revoke payment address error:", err.message);
    return res.status(500).json({ error: "Failed to revoke the address" });
  }
}

/**
 * POST /api/payment-addresses/:id/sweeps
 * { txHash, destination, amountUsdc, gasFundedTxHash }
 *
 * Records a sweep the user has already signed and broadcast in their browser.
 * The server never signs and never holds a key, so this is bookkeeping: the
 * transaction is already on chain by the time this is called.
 */
async function recordSweep(req, res) {
  try {
    const { txHash, destination, amountUsdc, gasFundedTxHash } = req.body || {};
    if (!HASH_RE.test(txHash || "")) {
      return res.status(400).json({ error: "Invalid transaction hash" });
    }
    if (!ADDRESS_RE.test(destination || "")) {
      return res.status(400).json({ error: "Invalid destination address" });
    }
    if (gasFundedTxHash && !HASH_RE.test(gasFundedTxHash)) {
      return res.status(400).json({ error: "Invalid gas funding transaction hash" });
    }
    const amount = Number(amountUsdc);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid swept amount" });
    }

    const record = await PaymentAddress.findOne({ _id: req.params.id, userId: req.user._id });
    if (!record) return res.status(404).json({ error: "Payment address not found" });

    // Idempotent: a retry after a dropped response must not append twice.
    if (!record.sweeps.some((s) => s.txHash === txHash)) {
      record.sweeps.push({
        txHash,
        destination,
        amountUsdc: amount,
        gasFundedTxHash: gasFundedTxHash || null,
      });
    }

    /**
     * `swept` is set NARROWLY, and only for an address that is finished
     * collecting. An address that is still `active` is still expected to receive
     * a top up, and flipping it here would stop the watcher and silently lose
     * that payment. Sweeping moves what has arrived; it does not close an
     * invoice. The sweeps array records the movement either way.
     *
     * AND IT IS ONLY SET WHEN THE CHAIN SAYS THE ADDRESS IS EMPTY.
     *
     * ARCHITECTURE.md 4.3 is explicit: "`swept` is the only terminal state, and
     * it is reached only after an on-chain balance read returns zero. Any state
     * that can still receive funds is watched." This set it on the browser's
     * word alone — the hash, the destination and the amount all came from the
     * request body and nothing was ever asked of the chain. So a sweep that
     * moved only part of the balance, a sweep whose transaction later reverted,
     * and a customer paying against an old QR code the day after all ended up at
     * an address in the one state no pass looks at: the grace pass reads
     * `expired` only, and `paid` and `revoked` are already unwatched (LW-003).
     * Confirmed money, arriving at an address nothing is watching, with no
     * detection, no notification and no record. Principle P1 forbids exactly
     * that.
     *
     * A FAILED READ IS NOT A ZERO. If the balance cannot be read the status is
     * left where it was and the response says why, so the address stays on the
     * Collected screen and stays watched. The sweep itself is still recorded
     * either way: what moved, moved, and losing that record would be worse.
     */
    let sweptNow = false;
    let residual = null;
    let balanceChecked = false;
    if (["paid", "expired", "revoked"].includes(record.status)) {
      const chain = getChain(record.chainId);
      if (chain && record.tokenContract) {
        const onChain = await tokenBalance(
          chain,
          record.tokenContract,
          record.address,
          record.tokenDecimals
        );
        if (onChain != null) {
          balanceChecked = true;
          residual = onChain;
          // Dust below the settlement tolerance is not a balance; it is rounding
          // that would cost more in gas than it is worth to move.
          if (onChain <= TOLERANCE) {
            record.status = "swept";
            sweptNow = true;
          }
        }
      }
    }

    await record.save();

    if (!sweptNow && ["paid", "expired", "revoked"].includes(record.status)) {
      console.warn(
        `[payment-address] sweep ${txHash} recorded on ${record.address} but it was NOT marked swept: ` +
          (balanceChecked
            ? `the chain still reports ${residual} ${record.tokenSymbol} there.`
            : "its balance could not be read, so it stays watched.")
      );
    }

    return res.status(201).json({
      paymentAddress: record,
      /**
       * Said out loud rather than left for the client to infer from `status`.
       * "We could not check" and "there is still money there" are different
       * facts and neither one is "done".
       */
      swept: sweptNow,
      balanceChecked,
      remainingOnChain: residual,
    });
  } catch (err) {
    console.error("record sweep error:", err.message);
    return res.status(500).json({ error: "Failed to record the sweep" });
  }
}

module.exports = { allocate, create, list, revoke, quote, recordSweep };
