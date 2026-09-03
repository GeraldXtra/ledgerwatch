const PaymentAddress = require("../models/PaymentAddress");
const Payment = require("../models/Payment");
const Debt = require("../models/Debt");
const User = require("../models/User");
const { getChain } = require("../config/chains");
const { GRACE_DAYS, GRACE_SCAN_MINUTES, blockTimeFor } = require("../config/derivation");
const { confirmationsFor } = require("./cryptoSettings.service");
const { recomputeDebtStatus } = require("./receivables.service");
const { notifyUser } = require("./push.service");
const { rpcCall, rpcCallTyped } = require("./rpc.service");
const { onInvoiceSettled } = require("./settlement.service");
const { resyncActivePaymentAddress } = require("./paymentAddress.service");

/**
 * PAYMENT WATCH — detects inbound stablecoin transfers to invoice addresses and
 * settles the invoice once they are confirmed deep enough to trust.
 *
 * Runs as a third pass inside automation.runAllPasses, under the same overlap
 * guard, so it also fires from the manual "Check now" trigger. It reads the
 * upstream RPC directly (server side) rather than through the browser-facing
 * proxy — the proxy's allowlist deliberately stays minimal for the client.
 *
 * Discipline matches coingecko.service: cached, single-flighted, logs once per
 * minute, and NEVER throws into the loop. A dead RPC must not stop reminders.
 */

// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Settlement tolerance: a payer who sends within this fraction of the asked
// amount has paid in full. Absorbs rounding and any fee dust taken in transit.
const TOLERANCE = Number(process.env.USDC_SETTLEMENT_TOLERANCE || 0.005);

/**
 * THE TOLERANCE MUST BE CAPPED IN ABSOLUTE TERMS, NOT LEFT PROPORTIONAL.
 *
 * `TOLERANCE` exists to absorb ROUNDING. The quote is rounded up to two decimal
 * places, so the largest honest shortfall is a fraction of a cent. As a bare
 * percentage that was fine on a testnet and quietly catastrophic on mainnet,
 * because 0.5 percent scales with the invoice:
 *
 *     invoice NGN      10,000  ->  forgives NGN 50
 *     invoice NGN     100,000  ->  forgives NGN 500
 *     invoice NGN 100,000,000  ->  forgives NGN 500,000
 *     invoice NGN 326,480,000  ->  forgives NGN 1,632,400
 *
 * And it does not merely forgive it. `creditNgn` on a full payment credits the
 * ENTIRE remaining balance, so the ledger records the whole invoice as received,
 * the reminders stop, and the owner's collected figure includes 1.6 million
 * naira that nobody ever sent. That is money invented in the book of account,
 * which is the one thing this system exists not to do.
 *
 * So the shortfall actually tolerated is the SMALLER of the percentage and a
 * few cents. Small invoices behave exactly as before; large ones stop forgiving
 * real money. Override with USDC_MAX_SHORTFALL if a payment rail genuinely
 * deducts more than this, and write down why.
 */
const MAX_SHORTFALL = Number(process.env.USDC_MAX_SHORTFALL || 0.05);

/** The largest shortfall that still counts as paid in full, in token units. */
function toleratedShortfall(expected) {
  const proportional = Number(expected || 0) * TOLERANCE;
  return Math.min(proportional, MAX_SHORTFALL);
}

// Never ask an RPC for an unbounded range; testnet nodes reject huge spans.
/**
 * Blocks per eth_getLogs query.
 *
 * MUST STAY UNDER THE NARROWEST RPC LIMIT of any chain in the registry. This was
 * 4000, and Base Sepolia's public RPC caps the range at 2000 — so EVERY log query
 * was rejected, on every pass, for every address. Because `rpc()` never throws it
 * returned null quietly, and since the high-water mark is only advanced inside the
 * success branch, `lastScannedBlock` stayed at 0 forever. The watcher looked
 * perfectly healthy while detecting nothing, and no payment could ever settle.
 *
 * 1500 leaves headroom under that 2000 cap. Raise it only after checking the
 * limit on every enabled chain, not just the one being tested.
 */
const MAX_BLOCK_SPAN = Number(process.env.PAYMENT_WATCH_BLOCK_SPAN || 1500);

/**
 * The span for ONE chain.
 *
 * A single global number was wrong the moment mainnet was enabled. Log ranges are
 * capped PER ENDPOINT, independently of how many results come back, and the caps
 * differ by an order of magnitude between chains and between providers on the
 * same chain. Measured 2026-08-29 with `npm run verify:chains`: publicnode serves
 * 50 blocks on Base, Arbitrum and Optimism while the official endpoints serve
 * 10,000; Alchemy's FREE TIER caps eth_getLogs at a 10 block range on every
 * network, which is why it is never the endpoint that ends up serving one.
 *
 * So the registry carries a measured `logSpan` per chain and this reads it. The
 * env var remains an override and the old 1500 remains the floor for any chain
 * that has not been measured, because a too-small span is slow while a too-large
 * one is the silent-failure mode described above: every query rejected, the
 * cursor never advancing, and a watcher that looks healthy while detecting
 * nothing.
 */
/**
 * The registry's MEASURED span wins. The env var is a ceiling, not a value.
 *
 * It used to be the other way round: any PAYMENT_WATCH_BLOCK_SPAN in the
 * environment replaced every chain's measured figure, and the deployed .env
 * carried 1500, so the 2000 measured for each mainnet was dead in production
 * and the verifier certified a number the watcher never used. A global env
 * value can only ever be right for one chain; it stays as a safety cap for an
 * operator who needs to pull every chain down at once.
 */
function spanFor(chain) {
  const measured = Number(chain && chain.logSpan);
  const base = Number.isFinite(measured) && measured > 0 ? measured : MAX_BLOCK_SPAN;
  const cap = Number(process.env.PAYMENT_WATCH_BLOCK_SPAN);
  return Number.isFinite(cap) && cap > 0 ? Math.min(base, cap) : base;
}

/**
 * How many spans one pass may walk for one address. The active pass used to
 * advance exactly one span per pass, so on Arbitrum (1,200 blocks produced per
 * five minute pass against a 2,000 block span) an hour's outage took four
 * hours to catch up, and past 72 hours an address expired with its payment
 * block never read. Six spans is 12,000 blocks: fifty minutes of Arbitrum per
 * pass, a ten fold margin, at six log queries per address instead of one.
 */
const MAX_WINDOWS_PER_PASS = 6;
/** Blocks re-read either side of a window boundary so a reorg at the edge is not missed. */
const GRACE_OVERLAP_BLOCKS = 50;

// ---- shared caches / single-flight -----------------------------------------
const blockCache = new Map(); // chainId -> { block, ts }
const BLOCK_TTL = 10 * 1000;
const decimalsCache = new Map(); // `${chainId}:${contract}` -> decimals
const inFlight = new Map();

function singleFlight(key, fn) {
  if (inFlight.has(key)) return inFlight.get(key);
  const p = (async () => {
    try {
      return await fn();
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, p);
  return p;
}

let lastErrorLogAt = 0;
function logOnce(scope, err) {
  const now = Date.now();
  if (now - lastErrorLogAt < 60000) return;
  lastErrorLogAt = now;
  console.error(`[paymentWatch] ${scope}:`, (err && err.message) || err);
}

/**
 * JSON-RPC against a chain. Never throws; null means the call did not succeed.
 *
 * Delegates to the shared rpc service rather than calling `fetch` directly, so
 * this watcher gets the endpoint fallback and the request timeout for free and
 * there is only one place where "how do we reach a chain" is decided. Without
 * that, a chain whose primary endpoint is refusing calls — which is exactly what
 * Alchemy was doing for every network except Ethereum — would silently detect no
 * payments at all while appearing to run normally.
 */
async function rpc(chain, method, params) {
  return rpcCall(chain, method, params);
}

async function currentBlock(chain) {
  const hit = blockCache.get(chain.chainId);
  if (hit && Date.now() - hit.ts < BLOCK_TTL) return hit.block;

  return singleFlight(`block:${chain.chainId}`, async () => {
    const hex = await rpc(chain, "eth_blockNumber", []);
    if (!hex) {
      // Serve stale rather than failing the pass.
      return hit ? hit.block : null;
    }
    const block = parseInt(hex, 16);
    blockCache.set(chain.chainId, { block, ts: Date.now() });
    return block;
  });
}

/**
 * Token decimals, READ FROM THE CONTRACT rather than trusted from config.
 * USDC uses 6, not the usual 18 — assuming 18 would misread every amount by a
 * factor of 10^12, which is the classic and very expensive version of this bug.
 */
async function tokenDecimals(chain, contract, fallback) {
  const key = `${chain.chainId}:${contract.toLowerCase()}`;
  if (decimalsCache.has(key)) return decimalsCache.get(key);

  return singleFlight(`dec:${key}`, async () => {
    // decimals() selector
    const result = await rpc(chain, "eth_call", [
      { to: contract, data: "0x313ce567" },
      "latest",
    ]);
    if (result && result !== "0x") {
      const parsed = parseInt(result, 16);
      if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 36) {
        // Only a SUCCESSFUL read is cached (LW-027). This used to cache the
        // fallback too, so one transient RPC failure latched the config value
        // for the life of the process: the exact pattern the logo cache was
        // fixed for. The fallback is still returned for this call, it is just
        // asked again next time.
        decimalsCache.set(key, parsed);
        return parsed;
      }
    }
    return fallback;
  });
}

/** Raw token units (hex or decimal string) -> a Number with `decimals` places. */
function unitsToAmount(raw, decimals) {
  const asBig = typeof raw === "string" && raw.startsWith("0x") ? BigInt(raw) : BigInt(raw || 0);
  const divisor = 10n ** BigInt(decimals);
  const whole = asBig / divisor;
  const frac = asBig % divisor;
  // Number() only at the end, on a value already scaled down — no precision loss
  // for realistic invoice sizes.
  return Number(whole) + Number(frac) / Number(divisor);
}

/** 32-byte left-padded address, as topics use. */
function addressTopic(address) {
  return "0x" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

/**
 * Live token balance of an address, as a Number in token units.
 *
 * This is the GRACE WATCH'S TRIGGER. Walking block ranges forward cannot work
 * across a 30 day gap: MAX_BLOCK_SPAN is 1500 blocks and 30 days on Base at
 * roughly 2s per block is about 1.3 million, so range catch-up would never
 * converge. One balanceOf call answers "did anything new arrive" for a fraction
 * of the cost, and only then is a log scan worth running.
 *
 * @returns {Promise<number|null>} null when the call fails
 */
async function tokenBalance(chain, contract, address, decimals) {
  const data = "0x70a08231" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const result = await rpc(chain, "eth_call", [{ to: contract, data }, "latest"]);
  if (!result || result === "0x") return null;
  try {
    return unitsToAmount(result, decimals);
  } catch {
    return null;
  }
}

/**
 * How much SHOULD be sitting at this address, from what we already know: every
 * transfer we have seen, less anything already swept out. A live balance above
 * this means money has arrived that we have not recorded yet.
 */
function accountedOnChain(pa) {
  const seen = pa.observed
    .filter((o) => o.status !== "orphaned")
    .reduce((sum, o) => sum + unitsToAmount(o.value, pa.tokenDecimals), 0);
  const swept = (pa.sweeps || []).reduce((sum, s) => sum + (Number(s.amountUsdc) || 0), 0);
  return Math.max(0, seen - swept);
}

/**
 * Flip addresses whose window has closed to `expired`, stamping when it happened.
 *
 * NOTHING set this before, so an address stayed `active` in the database forever:
 * the watcher stopped looking (it filters on expiresAt) but the invoice panel
 * still read "Awaiting payment" with a countdown frozen at "Expiring now", and
 * the ledger kept showing its chip. Both of those key off status.
 *
 * Deliberately scoped to `active` only — `paid`, `revoked` and `swept` are
 * terminal states and must never be overwritten by the clock.
 */
async function expireDueAddresses({ userId } = {}) {
  const query = { status: "active", expiresAt: { $lte: new Date() } };
  if (userId) query.userId = userId;
  try {
    const res = await PaymentAddress.updateMany(query, {
      $set: { status: "expired", expiredAt: new Date() },
    });
    return res.modifiedCount || 0;
  } catch (err) {
    logOnce("expire due addresses", err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// SETTLEMENT
// ---------------------------------------------------------------------------

/**
 * Re-evaluate an address against its invoice and settle if enough has arrived.
 *
 * Always assesses the RUNNING TOTAL of confirmed transfers, never a single
 * transfer in isolation, so several part payments accumulate correctly.
 */
async function settleIfDue(pa, chain) {
  const confirmed = pa.observed.filter((o) => o.status === "confirmed");
  const totalUsdc = confirmed.reduce((s, o) => s + unitsToAmount(o.value, pa.tokenDecimals), 0);
  if (totalUsdc <= 0) return null;

  /**
   * THE BASIS. Read this before changing anything below it.
   *
   * `totalUsdc` is CUMULATIVE across the whole life of this address.
   * `pa.expectedUsdc` is REMAINING: resyncActivePaymentAddress rewrites it after
   * every partial settlement to what is still owed.
   *
   * Comparing those two was LW-004, and it was not theoretical. After any
   * partial settlement the comparison is permanently biased toward true, so the
   * NEXT transfer of any size at all settles the entire remaining balance. Two
   * addresses in this database were primed for it: derivationIndex 19 held
   * receivedUsdc 20 against expectedUsdc 16.72 on a balance of 22,759.60 naira,
   * which means one cent would have closed it.
   *
   * So the comparison is made on ONE basis: what has arrived and NOT yet been
   * turned into a Payment, against what is still expected. `settledUsdc` is
   * derived from the settledPaymentId already stamped on each observed transfer,
   * so this is correct for rows written before this fix as well as after it, and
   * needs no migration.
   */
  /**
   * REPAIR BEFORE COUNTING.
   *
   * `settledPaymentId` is stamped in memory after Payment.create and persisted
   * only by the pa.save() further down. If that save failed (a version clash on
   * the observed array, a Mongo blip, a restart between the two lines), the
   * Payment existed but the stamps did not. On the next pass the same hash hit
   * the unique index and returned safely, but the moment a NEW transfer
   * arrived the key was new, the create succeeded, and every earlier transfer
   * was credited a second time. Real money invented in the ledger.
   *
   * So every pass first asks, for each confirmed transfer with no stamp,
   * whether a Payment already settled it, and stamps it if so. The stuck state
   * heals itself and the double credit cannot happen.
   */
  const unstamped = confirmed.filter((o) => !o.settledPaymentId && o.txHash);
  if (unstamped.length) {
    const hashes = unstamped.map((o) => o.txHash);
    const prior = await Payment.find({
      $or: [{ txHashes: { $in: hashes } }, { txHash: { $in: hashes } }],
    })
      .select("_id txHash txHashes")
      .lean();
    if (prior.length) {
      let repaired = 0;
      for (const o of unstamped) {
        const p = prior.find(
          (x) => x.txHash === o.txHash || (Array.isArray(x.txHashes) && x.txHashes.includes(o.txHash))
        );
        if (p) {
          o.settledPaymentId = p._id;
          repaired++;
        }
      }
      if (repaired) {
        await pa.save();
        console.warn(
          `[paymentWatch] repaired ${repaired} settlement stamp(s) on ${pa.address}: ` +
            `a previous save had not persisted them. No money was credited twice.`
        );
      }
    }
  }

  const settledUsdc = confirmed
    .filter((o) => o.settledPaymentId)
    .reduce((s, o) => s + unitsToAmount(o.value, pa.tokenDecimals), 0);
  const unsettledUsdc = Math.max(0, totalUsdc - settledUsdc);
  if (unsettledUsdc <= 0) return { outcome: "NOTHING_NEW" };

  /**
   * Convert with the SNAPSHOT rate stored when the address was issued, never the
   * live rate. The payer was told "send exactly this many USDC" — so sending that
   * amount must clear the invoice, however the naira has moved since. Using a
   * live rate would mean someone who paid precisely what was asked could still be
   * shown as owing money, which would be indefensible.
   */
  const settledNgn = unsettledUsdc * pa.ngnPerUsd;

  const debt = await Debt.findById(pa.debtId);
  if (!debt) return null;

  // What is still open right now, independent of this address.
  const rows = await Payment.aggregate([
    { $match: { debtId: debt._id } },
    { $group: { _id: null, paid: { $sum: "$amount" } } },
  ]);
  const alreadyPaid = rows.length ? rows[0].paid : 0;
  const remainingNgn = Math.max(0, (debt.amount || 0) - alreadyPaid);

  /**
   * MONEY THAT ARRIVES WITH NOTHING OWED IS STILL MONEY.
   *
   * This was `if (remainingNgn <= 0) return null;` — a bare early return in the
   * one path where silence costs the owner real funds (LW-002). It fired before
   * Payment.create, before receivedUsdc was updated, before status was set and
   * before save, so a confirmed transfer left no trace of any kind.
   *
   * There is no fourth outcome available here: value that has arrived is
   * credited, recorded as overpayment, or recorded as unattributed. It is never
   * discarded. See ARCHITECTURE.md section 4.4.
   */
  if (remainingNgn <= 0) {
    /**
     * ASSIGNED, not accumulated, and the difference matters.
     *
     * `unsettledUsdc` is already the running total of every confirmed transfer
     * that has never become a Payment, so it IS the unattributed figure. Adding
     * to it counted the same transfer again on every pass: a regression test
     * caught this reading 17.20 where the address had received 9.85.
     *
     * Assigning is also idempotent, which matters here more than anywhere else
     * in the file, because this branch runs on every grace scan for the life of
     * the address and must converge rather than drift.
     */
    pa.unattributedUsdc = unsettledUsdc;
    pa.unattributedAt = new Date();
    pa.receivedUsdc = totalUsdc;
    // Surfaced through the field the panel already renders, so the owner sees it
    // on the invoice rather than only in a log nobody reads.
    pa.unidentifiedBalanceAt = pa.unidentifiedBalanceAt || new Date();
    await pa.save();

    console.warn(
      `[paymentWatch] UNATTRIBUTED ${unsettledUsdc.toFixed(2)} ${pa.tokenSymbol} at ` +
        `${pa.address} on ${chain.name}: invoice ${debt._id} already owes nothing. ` +
        `Recorded against the address and the owner notified; the funds are ` +
        `swept from this address like any other balance.`
    );

    await notifyUser(
      pa.userId,
      {
        title: "Money arrived on a settled invoice",
        body:
          `${unsettledUsdc.toFixed(2)} ${pa.tokenSymbol} reached the address for ` +
          `${debt.debtorName}, which is already paid in full. It is safe in your ` +
          `derived address and can be swept.`,
        type: "tx",
      },
      "txUpdates"
    ).catch(() => {
      /* the record above is durable whether or not the push lands */
    });

    return { outcome: "UNATTRIBUTED", unattributedUsdc: unsettledUsdc };
  }

  // Both operands are now REMAINING. See the basis note above. The tolerance is
  // capped in absolute terms, so a large invoice cannot be closed while short by
  // a percentage that runs into millions of naira.
  const fullyPaid = unsettledUsdc >= pa.expectedUsdc - toleratedShortfall(pa.expectedUsdc);

  // On full payment credit the ENTIRE remaining balance so it lands on exactly
  // zero, rather than a few kobo short from rounding. Under-payment credits only
  // what actually arrived. Neither can exceed the remainder, so the balance can
  // never go negative.
  const creditNgn = fullyPaid ? remainingNgn : Math.min(settledNgn, remainingNgn);
  if (creditNgn <= 0) return null;

  // Idempotency key: the newest confirmed hash that has not yet settled.
  const unsettled = confirmed.filter((o) => !o.settledPaymentId);
  if (unsettled.length === 0) return null;
  const keyTx = unsettled[unsettled.length - 1];

  // Measured against the SAME remaining basis as fullyPaid. Using the cumulative
  // total here reported an overpayment that had not happened, with a warning
  // triangle, on any address that had ever taken a part payment.
  const overpaidUsdc = fullyPaid ? Math.max(0, unsettledUsdc - pa.expectedUsdc) : 0;
  const isLate = unsettled.some((o) => o.late);
  const noteParts = [
    `${unsettledUsdc.toFixed(2)} ${pa.tokenSymbol} received on ${chain.name}`,
    `rate ${pa.ngnPerUsd.toLocaleString("en-NG")} naira per ${pa.tokenSymbol}`,
  ];
  if (isLate) {
    // Settled at the SNAPSHOT rate even though it is late: the payer sent exactly
    // the amount they were quoted, so honouring that quote is the defensible
    // outcome however the naira has moved. The note records that it was late.
    noteParts.push("paid after the address expired");
  }
  if (overpaidUsdc > 0.004) {
    noteParts.push(
      `overpaid by ${overpaidUsdc.toFixed(2)} ${pa.tokenSymbol} ` +
        `(about ${Math.round(overpaidUsdc * pa.ngnPerUsd).toLocaleString("en-NG")} naira)`
    );
  }

  let payment;
  try {
    // The unique sparse index on txHash makes this the atomic guard: if this hash
    // already settled — repeated pass, restart mid-pass, manual trigger racing
    // the timer — the insert fails and we simply move on.
    payment = await Payment.create({
      debtId: debt._id,
      userId: pa.userId,
      amount: creditNgn,
      method: "crypto",
      note: noteParts.join(", "),
      txHash: keyTx.txHash,
      // Every hash this payment covers, so a lost stamp can be repaired. See
      // the repair block at the top of this function.
      txHashes: unsettled.map((o) => o.txHash),
    });
  } catch (err) {
    if (err && err.code === 11000) {
      // Already settled by an earlier pass whose stamps did not persist. Find
      // it and stamp now, rather than leaving the address stuck for another
      // pass. The repair block above will also catch this, but doing it here
      // keeps this pass's own state consistent.
      const existing = await Payment.findOne({ txHash: keyTx.txHash }).select("_id").lean();
      if (existing) {
        unsettled.forEach((o) => {
          o.settledPaymentId = existing._id;
        });
        await pa.save().catch((e) =>
          console.error(`[paymentWatch] could not persist repaired stamps on ${pa.address}: ${e.message}`)
        );
      }
      return null;
    }
    throw err;
  }

  // Mark every confirmed transfer as accounted for by this settlement.
  unsettled.forEach((o) => {
    o.settledPaymentId = payment._id;
  });

  pa.receivedUsdc = totalUsdc;
  pa.settledNgn = (pa.settledNgn || 0) + creditNgn;
  // ACCUMULATES. Assigning here meant a later partial settlement silently reset
  // an overpayment the owner had already been shown to zero.
  pa.overpaidUsdc = (pa.overpaidUsdc || 0) + overpaidUsdc;

  if (fullyPaid) {
    pa.status = "paid";
  }
  try {
    await pa.save();
  } catch (err) {
    /**
     * The Payment is durable; these stamps are not. Say so LOUDLY with the
     * hashes, because this is the exact state that used to become a double
     * credit. The repair block at the top of this function fixes it on the
     * next pass; this log is so a human can see that it happened.
     */
    console.error(
      `[paymentWatch] SETTLED payment ${payment._id} for ${pa.address} but could not save the ` +
        `address stamps (${err.message}). Hashes ${unsettled.map((o) => o.txHash).join(",")}. ` +
        `They will be repaired on the next pass; nothing will be credited twice.`
    );
  }

  /**
   * Restate what is still needed, at the SAME snapshot rate, through the shared
   * helper. The formula used to be inlined here and existed nowhere else, which
   * is precisely why a bank payment never updated the quote. One implementation,
   * called from every path that changes the balance.
   */
  if (!fullyPaid) await resyncActivePaymentAddress(debt._id);

  // Reuse the shared recompute so a crypto settlement behaves exactly like a
  // manual payment: status, history and reminder cancellation all identical.
  await recomputeDebtStatus(debt);

  /**
   * ONE EVENT, THREE CONSEQUENCES.
   *
   * The Payment record, the owner's push and the payer's receipt all fire from
   * this single point. Scattering them would let a settlement exist that nobody
   * was told about, or an email claiming a payment that was never recorded —
   * the three can now only ever agree.
   */
  /**
   * The SAME event the bank route fires. This used to be a local function here,
   * so a bank payment settled silently while a crypto payment emailed and
   * notified. One implementation, so the two can never disagree.
   */
  await onInvoiceSettled({
    debt,
    payment,
    method: "crypto",
    creditNgn,
    fullyPaid,
    pa,
    chain,
    totalUsdc,
    isLate,
  }).catch((err) => console.error("[paymentWatch] settlement event failed:", err.message));

  return { payment, fullyPaid, totalUsdc, creditNgn };
}


// ---------------------------------------------------------------------------
// WATCH
// ---------------------------------------------------------------------------

/**
 * Scan one address for new transfers and advance confirmation states.
 *
 * @param {"active"|"grace"} mode
 *   `active` walks block ranges forward from lastScannedBlock, which is exact.
 *   `grace` cannot: the gap since expiry may be millions of blocks. It instead
 *   asks for the balance, and only scans a recent window when that balance shows
 *   money we have not accounted for.
 */
async function scanAddress(pa, chain, head, mode = "active") {
  const decimals = await tokenDecimals(chain, pa.tokenContract, pa.tokenDecimals);
  if (decimals !== pa.tokenDecimals) pa.tokenDecimals = decimals;

  pa.lastWatchedAt = new Date();

  const span = spanFor(chain);
  /** Block ranges to read, oldest first. Each is at most one span wide. */
  const windows = [];
  let scanning = true;

  if (mode === "grace") {
    const live = await tokenBalance(chain, pa.tokenContract, pa.address, decimals);
    const expected = accountedOnChain(pa);
    // One unit at the token's precision, so floating point noise cannot register
    // as an arrival.
    const dust = 1 / 10 ** decimals;
    const hasNewMoney = live !== null && live > expected + dust;

    // Nothing new, and nothing part way to confirming: this address costs one
    // eth_call an hour and no more.
    const awaitingConfirmation = pa.observed.some((o) => o.status === "detected");
    if (!hasNewMoney && !awaitingConfirmation) return { found: 0, newlyConfirmed: 0, late: 0 };

    if (hasNewMoney) {
      /**
       * LW-026. The grace scan read exactly ONE span back from the head, once
       * an hour. One span is five hours of Ethereum but six minutes of Arbitrum
       * and eleven of BNB, so on six of seven mainnets most of every hour was
       * never read: the balance check saw the money, the log scan could not
       * find the transfer, and the invoice sat with unidentifiedBalanceAt set
       * and never settled. The window now covers the whole interval since the
       * last grace scan in CHAIN TIME, read in as many spans as that takes.
       */
      const blockTime = blockTimeFor(chain.chainId);
      const needed = Math.ceil((GRACE_SCAN_MINUTES * 60) / blockTime) + GRACE_OVERLAP_BLOCKS;
      const covered = Math.min(needed, span * MAX_WINDOWS_PER_PASS);
      const oldest = Math.max(0, head - covered + 1);
      for (let lo = oldest; lo <= head; lo += span) {
        windows.push({ from: lo, to: Math.min(head, lo + span - 1) });
      }
    } else {
      scanning = false; // only advancing confirmations
    }
  } else {
    /**
     * Catch up in several spans when behind, not one. See MAX_WINDOWS_PER_PASS.
     * Each window is committed as it succeeds, so a failure part way leaves the
     * cursor at the last block actually read rather than at zero progress.
     */
    let from = pa.lastScannedBlock > 0 ? pa.lastScannedBlock + 1 : Math.max(0, head - span);
    for (let n = 0; n < MAX_WINDOWS_PER_PASS && from <= head; n++) {
      const to = Math.min(head, from + span);
      windows.push({ from, to });
      from = to + 1;
    }
  }

  let found = 0;
  let late = 0;

  if (scanning) {
    for (const w of windows) {
      const logs = await rpc(chain, "eth_getLogs", [
        {
          address: pa.tokenContract, // ONLY the configured stablecoin
          topics: [TRANSFER_TOPIC, null, addressTopic(pa.address)],
          fromBlock: "0x" + w.from.toString(16),
          toBlock: "0x" + w.to.toString(16),
        },
      ]);

      if (!Array.isArray(logs)) {
        /**
         * The query failed. This is the branch that hid a total detection outage:
         * `rpc()` never throws, so a rejected query is indistinguishable from a
         * quiet chain unless it is said out loud. An active address whose
         * high-water mark is still 0 after being watched has NEVER succeeded, and
         * that is a broken watcher rather than an absence of payments.
         *
         * Stop here. Windows after this one are not read, and the cursor stays
         * at the last window that succeeded, so nothing is skipped.
         */
        if (mode === "active" && pa.lastScannedBlock === 0) {
          console.error(
            `[paymentWatch] ${chain.name}: log query FAILED for ${pa.address} over ` +
              `${w.to - w.from + 1} blocks and has never succeeded. Payments to this address ` +
              `cannot be detected. If this repeats, the log span for this chain (${span}) ` +
              `is likely above this RPC's range limit.`
          );
        }
        break;
      }

      for (const log of logs) {
        if (pa.observed.some((o) => o.txHash === log.transactionHash)) continue;
        // Arrived after the address stopped accepting payment. It still settles —
        // the payer sent what they were quoted — but it is flagged so the owner is
        // told, rather than an invoice quietly changing after it looked closed.
        const isLate = pa.expiresAt && Date.now() > new Date(pa.expiresAt).getTime();
        pa.observed.push({
          txHash: log.transactionHash,
          from: "0x" + String(log.topics[1] || "").slice(-40),
          value: BigInt(log.data || "0x0").toString(),
          blockNumber: parseInt(log.blockNumber, 16),
          blockHash: log.blockHash,
          status: "detected",
          late: isLate,
        });
        found++;
        if (isLate) late++;
      }
      // Only the forward-walking pass may advance the high-water mark, and only
      // to the end of a window it actually read. The grace scan reads a recent
      // window that says nothing about the blocks in between, so moving it
      // there would skip everything it never looked at.
      if (mode === "active") pa.lastScannedBlock = w.to;
    }
  }

  // Money is present that no Transfer log in the recent window explains — it
  // arrived earlier than the window reaches. Flag it rather than leaving a silent
  // discrepancy: the balance is real and visible on the explorer.
  if (mode === "grace" && scanning) {
    if (found === 0) {
      if (!pa.unidentifiedBalanceAt) pa.unidentifiedBalanceAt = new Date();
    } else {
      pa.unidentifiedBalanceAt = null;
    }
  }

  // Advance detected -> confirmed, and catch reorgs. Depth honours the owner's
  // per-chain override when they have set one, clamped where it is read.
  const owner = await User.findById(pa.userId).select("crypto");
  const needed = confirmationsFor(chain.chainId, owner);
  let newlyConfirmed = 0;

  for (const o of pa.observed) {
    if (o.status === "confirmed" || o.status === "orphaned") continue;

    o.confirmations = Math.max(0, head - (o.blockNumber || head) + 1);

    if (o.confirmations >= needed) {
      // Before trusting it, check the transaction still exists. If it vanished in
      // a reorg the receipt is gone, and settling on it would credit money that
      // never arrived.
      /**
       * LW-006. `rpcCall` returned null for four different conditions, and this
       * line read every one of them as "the transaction vanished in a reorg" and
       * stamped the transfer `orphaned`, which nothing ever revisits. On BNB
       * Chain, whose only endpoint refuses eth_getTransactionReceipt outright,
       * that meant EVERY payment was written off as a reorg that never happened.
       *
       * The typed call separates the two. A transport failure leaves the row
       * `detected` and tries again next pass. Only a successful call that
       * returns null, which is the chain itself saying "no such transaction",
       * is a reorg.
       */
      const r = await rpcCallTyped(chain, "eth_getTransactionReceipt", [o.txHash]);
      if (!r.ok) {
        console.warn(
          `[paymentWatch] could not check ${o.txHash} on ${chain.name} (${r.reason}); ` +
            `leaving it detected and retrying next pass`
        );
        continue;
      }
      if (r.result === null) {
        o.status = "orphaned";
        console.error(`[paymentWatch] reorg: ${o.txHash} vanished before confirming`);
        continue;
      }
      o.status = "confirmed";
      o.confirmedAt = new Date();
      newlyConfirmed++;
    }
  }

  return { found, newlyConfirmed, late };
}

/**
 * One watch pass over every address that is still accepting payment.
 * @returns {Promise<{addressesChecked:number, detected:number, confirmed:number, settled:number}>}
 */
async function runPaymentWatchPass({ userId } = {}) {
  // Close the window on anything past its expiry BEFORE selecting work, so an
  // address never sits in a state the rest of the app misreads.
  const expiredNow = await expireDueAddresses({ userId });

  const now = new Date();
  const activeQuery = { status: "active", expiresAt: { $gt: now } };

  /**
   * Grace: expired inside the grace window, and not looked at recently. Money
   * sent after the deadline must still be found — it is the payer's money and it
   * really is at that address — but it is neither urgent nor common, so each one
   * gets a cheap check an hour rather than one a minute for thirty days.
   */
  const graceQuery = {
    status: "expired",
    expiredAt: { $gte: new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000) },
    $or: [
      { lastWatchedAt: null },
      { lastWatchedAt: { $lt: new Date(Date.now() - GRACE_SCAN_MINUTES * 60 * 1000) } },
    ],
  };

  if (userId) {
    activeQuery.userId = userId;
    graceQuery.userId = userId;
  }

  let addresses;
  try {
    const [live, grace] = await Promise.all([
      PaymentAddress.find(activeQuery).limit(200),
      PaymentAddress.find(graceQuery).limit(50),
    ]);
    addresses = [
      ...live.map((pa) => ({ pa, mode: "active" })),
      ...grace.map((pa) => ({ pa, mode: "grace" })),
    ];
  } catch (err) {
    logOnce("load addresses", err);
    return { addressesChecked: 0, detected: 0, confirmed: 0, settled: 0, expired: expiredNow };
  }

  let detected = 0;
  let confirmed = 0;
  let settled = 0;
  let lateDetected = 0;

  for (const { pa, mode } of addresses) {
    try {
      const chain = getChain(pa.chainId);
      if (!chain) continue;

      const head = await currentBlock(chain);
      if (!head) continue; // RPC down for this chain; try again next pass

      const res = await scanAddress(pa, chain, head, mode);
      detected += res.found;
      confirmed += res.newlyConfirmed;
      lateDetected += res.late;

      if (res.found > 0) {
        const owner = await User.findById(pa.userId).select("crypto");
        // notifyOnDetected is the user's call: some would rather hear only when
        // money has actually settled than twice for every payment.
        if (!owner || owner.crypto?.notifyOnDetected !== false) {
          await notifyUser(
            pa.userId,
            {
              title: res.late ? "Late payment detected" : "Payment detected",
              body: res.late
                ? `${pa.tokenSymbol} arrived on ${chain.name} after this address expired. Waiting for confirmations.`
                : `${pa.tokenSymbol} arrived on ${chain.name}. Waiting for confirmations.`,
              tag: `detect-${pa._id}`,
              type: "payment",
              url: "/app/receivables",
            },
            "txUpdates"
          ).catch(() => {});
        }
      }

      await pa.save();

      const outcome = await settleIfDue(pa, chain);
      if (outcome) settled++;
    } catch (err) {
      // One bad address must never stop the pass, and never the whole loop.
      logOnce(`address ${pa._id}`, err);
    }
  }

  return {
    addressesChecked: addresses.length,
    detected,
    confirmed,
    settled,
    expired: expiredNow,
    late: lateDetected,
  };
}

module.exports = {
  runPaymentWatchPass,
  expireDueAddresses,
  settleIfDue,
  scanAddress,
  unitsToAmount,
  toleratedShortfall,
  MAX_SHORTFALL,
  accountedOnChain,
  tokenBalance,
  addressTopic,
  TRANSFER_TOPIC,
  TOLERANCE,
};
