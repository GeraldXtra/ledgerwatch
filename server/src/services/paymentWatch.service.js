const PaymentAddress = require("../models/PaymentAddress");
const Payment = require("../models/Payment");
const Debt = require("../models/Debt");
const User = require("../models/User");
const Reminder = require("../models/Reminder");
const { getChain } = require("../config/chains");
const { GRACE_DAYS, GRACE_SCAN_MINUTES } = require("../config/derivation");
const { confirmationsFor } = require("./cryptoSettings.service");
const { recomputeDebtStatus } = require("./receivables.service");
const { notifyUser } = require("./push.service");
const { rpcCall } = require("./rpc.service");

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
    let decimals = fallback;
    if (result && result !== "0x") {
      const parsed = parseInt(result, 16);
      if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 36) decimals = parsed;
    }
    decimalsCache.set(key, decimals);
    return decimals;
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
   * Convert with the SNAPSHOT rate stored when the address was issued, never the
   * live rate. The payer was told "send exactly this many USDC" — so sending that
   * amount must clear the invoice, however the naira has moved since. Using a
   * live rate would mean someone who paid precisely what was asked could still be
   * shown as owing money, which would be indefensible.
   */
  const settledNgn = totalUsdc * pa.ngnPerUsd;

  const debt = await Debt.findById(pa.debtId);
  if (!debt) return null;

  // What is still open right now, independent of this address.
  const rows = await Payment.aggregate([
    { $match: { debtId: debt._id } },
    { $group: { _id: null, paid: { $sum: "$amount" } } },
  ]);
  const alreadyPaid = rows.length ? rows[0].paid : 0;
  const remainingNgn = Math.max(0, (debt.amount || 0) - alreadyPaid);
  if (remainingNgn <= 0) return null; // nothing left to settle

  const fullyPaid = totalUsdc >= pa.expectedUsdc * (1 - TOLERANCE);

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

  const overpaidUsdc = fullyPaid ? Math.max(0, totalUsdc - pa.expectedUsdc) : 0;
  const isLate = unsettled.some((o) => o.late);
  const noteParts = [
    `${totalUsdc.toFixed(2)} ${pa.tokenSymbol} received on ${chain.name}`,
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
    });
  } catch (err) {
    if (err && err.code === 11000) return null; // already settled, nothing to do
    throw err;
  }

  // Mark every confirmed transfer as accounted for by this settlement.
  unsettled.forEach((o) => {
    o.settledPaymentId = payment._id;
  });

  pa.receivedUsdc = totalUsdc;
  pa.settledNgn = (pa.settledNgn || 0) + creditNgn;
  pa.overpaidUsdc = overpaidUsdc;

  if (fullyPaid) {
    pa.status = "paid";
  } else {
    // Keep accepting top ups, and restate what is still needed AT THE SAME RATE
    // so the payer is never quoted a moving target.
    pa.expectedUsdc = Math.ceil(((remainingNgn - creditNgn) / pa.ngnPerUsd) * 100) / 100;
  }
  await pa.save();

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
  await onInvoiceSettled({ pa, chain, debt, payment, totalUsdc, creditNgn, fullyPaid, isLate });

  return { payment, fullyPaid, totalUsdc, creditNgn };
}

/**
 * Everything that must happen when an invoice settles in crypto. Never throws:
 * the money has already arrived and the ledger is already correct, so a failed
 * notification must not undo a successful settlement.
 */
async function onInvoiceSettled({ pa, chain, debt, payment, totalUsdc, creditNgn, fullyPaid, isLate }) {
  // 1. Tell the owner.
  await notifyUser(
    pa.userId,
    {
      title: fullyPaid
        ? `Invoice settled — ${debt.debtorName}`
        : `Part payment received — ${debt.debtorName}`,
      body:
        `${totalUsdc.toFixed(2)} ${pa.tokenSymbol} confirmed on ${chain.name}.` +
        (isLate ? " This arrived after the payment address had expired." : ""),
      tag: `pay-${pa._id}`,
      type: "payment",
      url: "/app/receivables",
    },
    "txUpdates"
  ).catch(() => {});

  // 2. Send the payer a receipt, if we have somewhere to send it.
  try {
    if (debt.debtorEmail) {
      // eslint-disable-next-line global-require
      const { sendEmail, getLogoAttachment, isNonRoutableEmail } = require("./notify.service");
      // eslint-disable-next-line global-require
      const { buildPaymentReceiptEmail } = require("../utils/paymentReceipt");
      // eslint-disable-next-line global-require
      const User = require("../models/User");

      if (isNonRoutableEmail(debt.debtorEmail)) {
        console.warn(
          `[paymentWatch] receipt not sent: ${debt.debtorEmail} is a reserved domain and would bounce.`
        );
      } else {
        const owner = await User.findById(pa.userId).select("name bankDetails");
        const logo = getLogoAttachment();
        const { html, text } = buildPaymentReceiptEmail({
          businessName: owner && owner.name,
          debtorName: debt.debtorName,
          amountUsdc: totalUsdc,
          tokenSymbol: pa.tokenSymbol,
          creditNgn,
          chain,
          txHash: (pa.observed.find((o) => o.settledPaymentId) || {}).txHash,
          fullyPaid,
          isLate,
          remainingNgn: Math.max(0, (debt.amount || 0) - (creditNgn + ((debt.amountPaid || 0)))),
          hasLogo: Boolean(logo),
        });
        const res = await sendEmail(
          debt.debtorEmail,
          fullyPaid
            ? `Payment received in full — thank you`
            : `Payment received — thank you`,
          html,
          { text, attachments: logo ? [logo] : [] }
        );
        if (!res.ok) {
          console.error(`[paymentWatch] receipt email failed: ${res.error}`);
        }
      }
    }
  } catch (err) {
    console.error("[paymentWatch] receipt email error:", err.message);
  }
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

  let from;
  let to;
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
      from = Math.max(0, head - MAX_BLOCK_SPAN);
      to = head;
    } else {
      scanning = false; // only advancing confirmations
    }
  } else {
    from = pa.lastScannedBlock > 0 ? pa.lastScannedBlock + 1 : Math.max(0, head - MAX_BLOCK_SPAN);
    to = Math.min(head, from + MAX_BLOCK_SPAN);
  }

  let found = 0;
  let late = 0;

  if (scanning && to >= from) {
    const logs = await rpc(chain, "eth_getLogs", [
      {
        address: pa.tokenContract, // ONLY the configured stablecoin
        topics: [TRANSFER_TOPIC, null, addressTopic(pa.address)],
        fromBlock: "0x" + from.toString(16),
        toBlock: "0x" + to.toString(16),
      },
    ]);

    if (Array.isArray(logs)) {
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
      // Only the forward-walking pass may advance the high-water mark. The grace
      // scan reads a recent window that says nothing about the blocks in between,
      // so moving it here would skip everything it never looked at.
      if (mode === "active") pa.lastScannedBlock = to;
    } else {
      /**
       * The query failed. This is the branch that hid a total detection outage:
       * `rpc()` never throws, so a rejected query is indistinguishable from a
       * quiet chain unless it is said out loud. An active address whose
       * high-water mark is still 0 after being watched has NEVER succeeded, and
       * that is a broken watcher rather than an absence of payments.
       */
      if (mode === "active" && pa.lastScannedBlock === 0) {
        console.error(
          `[paymentWatch] ${chain.name}: log query FAILED for ${pa.address} over ` +
            `${to - from + 1} blocks and has never succeeded. Payments to this address ` +
            `cannot be detected. If this repeats, PAYMENT_WATCH_BLOCK_SPAN (${MAX_BLOCK_SPAN}) ` +
            `is likely above this RPC's range limit.`
        );
      }
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
      const receipt = await rpc(chain, "eth_getTransactionReceipt", [o.txHash]);
      if (receipt === null) {
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
  accountedOnChain,
  tokenBalance,
  addressTopic,
  TRANSFER_TOPIC,
  TOLERANCE,
};
