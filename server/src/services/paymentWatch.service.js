const PaymentAddress = require("../models/PaymentAddress");
const Payment = require("../models/Payment");
const Debt = require("../models/Debt");
const User = require("../models/User");
const { getChain } = require("../config/chains");
const { GRACE_DAYS, GRACE_SCAN_MINUTES, blockTimeFor } = require("../config/derivation");
const { confirmationsFor } = require("./cryptoSettings.service");
const { recomputeDebtStatus, paidKoboForDebt } = require("./receivables.service");
const {
  toUnits,
  decimalToUnits,
  unitsToNumber,
  unitsToKobo,
  koboOf,
  koboToNaira,
  nairaToKobo,
  shareOf,
  minUnits,
  maxUnits,
} = require("../domain/money");
const { notifyActivity } = require("./activity.service");
const { rpcCall, rpcCallTyped } = require("./rpc.service");
const { onInvoiceSettled } = require("./settlement.service");
const { reportProblem } = require("./opsAlert.service");
const { resyncActivePaymentAddress } = require("./paymentAddress.service");

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const TOLERANCE = Number(process.env.USDC_SETTLEMENT_TOLERANCE || 0.005);

const MAX_SHORTFALL = Number(process.env.USDC_MAX_SHORTFALL || 0.05);

const NOTE_THRESHOLD = 0.004;

function toleratedShortfallUnits(expectedUnits, decimals) {
  const proportional = shareOf(maxUnits(0n, expectedUnits), TOLERANCE);
  const cap = decimalToUnits(Number.isFinite(MAX_SHORTFALL) && MAX_SHORTFALL > 0 ? MAX_SHORTFALL : 0, decimals);
  return minUnits(proportional, cap);
}

function toleratedShortfall(expected, decimals = 6) {
  return unitsToNumber(toleratedShortfallUnits(decimalToUnits(Number(expected) || 0, decimals), decimals), decimals);
}

const MAX_BLOCK_SPAN = Number(process.env.PAYMENT_WATCH_BLOCK_SPAN || 1500);

function spanFor(chain) {
  const measured = Number(chain && chain.logSpan);
  const base = Number.isFinite(measured) && measured > 0 ? measured : MAX_BLOCK_SPAN;
  const cap = Number(process.env.PAYMENT_WATCH_BLOCK_SPAN);
  return Number.isFinite(cap) && cap > 0 ? Math.min(base, cap) : base;
}

const MAX_WINDOWS_PER_PASS = 6;

const GRACE_MAX_WINDOWS = 24;

const GRACE_OVERLAP_BLOCKS = 50;

const ACTIVE_LIMIT = 200;
const GRACE_LIMIT = 50;

const PASS_BUDGET_MS = Number(process.env.PAYMENT_WATCH_PASS_BUDGET_MS) > 0
  ? Number(process.env.PAYMENT_WATCH_PASS_BUDGET_MS)
  : 45000;

const blockCache = new Map();
const BLOCK_TTL = 10 * 1000;
const decimalsCache = new Map();
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

const lastErrorLogAt = new Map();
const LOG_THROTTLE_MS = 60000;
const MAX_LOG_SCOPES = 500;

function logOnce(scope, err) {
  const now = Date.now();
  const prev = lastErrorLogAt.get(scope);
  if (prev && now - prev.at < LOG_THROTTLE_MS) {
    prev.suppressed++;
    return;
  }
  if (lastErrorLogAt.size > MAX_LOG_SCOPES) {
    for (const [key, entry] of lastErrorLogAt) {
      if (now - entry.at > LOG_THROTTLE_MS) lastErrorLogAt.delete(key);
    }
  }
  const alsoSuppressed = prev && prev.suppressed ? ` (+${prev.suppressed} suppressed)` : "";
  lastErrorLogAt.set(scope, { at: now, suppressed: 0 });
  console.error(`[paymentWatch] ${scope}${alsoSuppressed}:`, (err && err.message) || err);
}

async function rpc(chain, method, params) {
  return rpcCall(chain, method, params);
}

async function currentBlock(chain) {
  const hit = blockCache.get(chain.chainId);
  if (hit && Date.now() - hit.ts < BLOCK_TTL) return hit.block;

  return singleFlight(`block:${chain.chainId}`, async () => {
    const hex = await rpc(chain, "eth_blockNumber", []);
    if (!hex) {
      return hit ? hit.block : null;
    }
    const block = parseInt(hex, 16);
    blockCache.set(chain.chainId, { block, ts: Date.now() });
    return block;
  });
}

async function tokenDecimals(chain, contract, fallback) {
  const key = `${chain.chainId}:${contract.toLowerCase()}`;
  if (decimalsCache.has(key)) return decimalsCache.get(key);

  return singleFlight(`dec:${key}`, async () => {
    const result = await rpc(chain, "eth_call", [
      { to: contract, data: "0x313ce567" },
      "latest",
    ]);
    if (result && result !== "0x") {
      const parsed = parseInt(result, 16);
      if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 36) {
        decimalsCache.set(key, parsed);
        return parsed;
      }
    }
    return fallback;
  });
}

function unitsToAmount(raw, decimals) {
  return unitsToNumber(toUnits(raw), decimals);
}

function addressTopic(address) {
  return "0x" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

async function tokenBalanceUnits(chain, contract, address) {
  const data = "0x70a08231" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const result = await rpc(chain, "eth_call", [{ to: contract, data }, "latest"]);
  if (!result || result === "0x") return null;
  try {
    return toUnits(result);
  } catch {
    return null;
  }
}

async function tokenBalance(chain, contract, address, decimals) {
  const units = await tokenBalanceUnits(chain, contract, address);
  return units === null ? null : unitsToNumber(units, decimals);
}

function sweptUnits(pa) {
  return (pa.sweeps || []).reduce((sum, s) => sum + decimalToUnits(Number(s.amountUsdc) || 0, pa.tokenDecimals), 0n);
}

function accountedUnits(pa) {
  const seen = pa.observed
    .filter((o) => o.status !== "orphaned")
    .reduce((sum, o) => sum + toUnits(o.value), 0n);
  return maxUnits(0n, seen - sweptUnits(pa));
}

function confirmedUnsweptUnits(pa) {
  const confirmed = (pa.observed || [])
    .filter((o) => o.status === "confirmed")
    .reduce((sum, o) => sum + toUnits(o.value), 0n);
  return confirmed - sweptUnits(pa);
}

function accountedOnChain(pa) {
  return unitsToNumber(accountedUnits(pa), pa.tokenDecimals);
}

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

async function settleIfDue(pa, chain) {
  const decimals = pa.tokenDecimals;
  const confirmed = pa.observed.filter((o) => o.status === "confirmed");
  const totalUnits = confirmed.reduce((s, o) => s + toUnits(o.value), 0n);
  if (totalUnits <= 0n) return null;
  const totalUsdc = unitsToNumber(totalUnits, decimals);

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

  const settledUnits = confirmed
    .filter((o) => o.settledPaymentId)
    .reduce((s, o) => s + toUnits(o.value), 0n);
  const unsettledUnits = maxUnits(0n, totalUnits - settledUnits);
  if (unsettledUnits <= 0n) return { outcome: "NOTHING_NEW" };
  const unsettledUsdc = unitsToNumber(unsettledUnits, decimals);

  const receivedKobo = unitsToKobo(unsettledUnits, decimals, pa.ngnPerUsd);

  const debt = await Debt.findById(pa.debtId);
  if (!debt) {
    pa.unattributedUsdc = unsettledUsdc;
    pa.unattributedAt = new Date();
    pa.receivedUsdc = totalUsdc;
    pa.unidentifiedBalanceAt = pa.unidentifiedBalanceAt || new Date();
    await pa.save().catch((err) =>
      console.error(`[paymentWatch] could not record orphaned receipt on ${pa.address}: ${err.message}`)
    );
    console.error(
      `[paymentWatch] ORPHANED ${unsettledUsdc.toFixed(2)} ${pa.tokenSymbol} at ${pa.address} ` +
        `on ${chain.name}: invoice ${pa.debtId} no longer exists. Recorded as unattributed ` +
        `against the address; the funds are still there and can be swept.`
    );
    await notifyActivity(pa.userId, {
      category: "moneyIn",
      tag: `orphan-${pa._id}`,
      url: "/app/receivables",
      symbol: pa.tokenSymbol,
      title: "Money arrived on a deleted invoice",
      body:
        `${unsettledUsdc.toFixed(2)} ${pa.tokenSymbol} reached a payment address whose ` +
        `invoice no longer exists. It is safe in your derived address and can be swept.`,
      email: {
        subject: `${unsettledUsdc.toFixed(2)} ${pa.tokenSymbol} arrived on a deleted invoice`,
        intro:
          "Money reached a payment address whose invoice has since been deleted. Nothing was lost: " +
          "it is held at that address, which only your wallet can move, and you can sweep it to your wallet.",
        tone: "info",
        hero: { label: "Received", value: `${unsettledUsdc.toFixed(2)} ${pa.tokenSymbol}`, sub: `on ${chain.name}` },
        rows: [
          { label: "Payment address", value: pa.address, mono: true },
          { label: "Network", value: chain.name },
        ],
      },
    }).catch(() => {});
    return { outcome: "ORPHANED_INVOICE", unattributedUsdc: unsettledUsdc };
  }

  const alreadyPaidKobo = await paidKoboForDebt(debt._id);
  const remainingKobo = Math.max(0, koboOf(debt) - alreadyPaidKobo);
  const remainingNgn = koboToNaira(remainingKobo);

  if (remainingKobo <= 0) {
    pa.unattributedUsdc = unsettledUsdc;
    pa.unattributedAt = new Date();
    pa.receivedUsdc = totalUsdc;
    pa.unidentifiedBalanceAt = pa.unidentifiedBalanceAt || new Date();
    await pa.save();

    console.warn(
      `[paymentWatch] UNATTRIBUTED ${unsettledUsdc.toFixed(2)} ${pa.tokenSymbol} at ` +
        `${pa.address} on ${chain.name}: invoice ${debt._id} already owes nothing. ` +
        `Recorded against the address and the owner notified; the funds are ` +
        `swept from this address like any other balance.`
    );

    await notifyActivity(pa.userId, {
      category: "moneyIn",
      tag: `unattributed-${pa._id}`,
      url: "/app/receivables",
      symbol: pa.tokenSymbol,
      title: "Money arrived on a settled invoice",
      body:
        `${unsettledUsdc.toFixed(2)} ${pa.tokenSymbol} reached the address for ` +
        `${debt.debtorName}, which is already paid in full. It is safe in your ` +
        `derived address and can be swept.`,
      email: {
        subject: `${unsettledUsdc.toFixed(2)} ${pa.tokenSymbol} arrived for ${debt.debtorName}`,
        intro:
          `${debt.debtorName} has already paid this invoice in full, and more money has arrived at its ` +
          "payment address. It is recorded and safe there, and you can sweep it to your wallet.",
        tone: "info",
        hero: { label: "Received", value: `${unsettledUsdc.toFixed(2)} ${pa.tokenSymbol}`, sub: `on ${chain.name}` },
        rows: [
          { label: "Debtor", value: debt.debtorName },
          { label: "Payment address", value: pa.address, mono: true },
          { label: "Network", value: chain.name },
        ],
      },
    }).catch(() => {});

    return { outcome: "UNATTRIBUTED", unattributedUsdc: unsettledUsdc };
  }

  const expectedUnits = decimalToUnits(Number(pa.expectedUsdc) || 0, decimals);
  const fullyPaid = unsettledUnits >= expectedUnits - toleratedShortfallUnits(expectedUnits, decimals);

  const creditKobo = fullyPaid ? remainingKobo : Math.min(receivedKobo, remainingKobo);
  const creditNgn = koboToNaira(creditKobo);
  if (creditKobo <= 0) {
    const line =
      `${unsettledUsdc.toFixed(2)} ${pa.tokenSymbol} at ${pa.address} on ` +
      `${chain.name} credits nothing against invoice ${debt._id}, which still owes ` +
      `${Math.round(remainingNgn).toLocaleString("en-NG")} naira. Nothing was written.`;
    console.error(`[paymentWatch] ${line}`);
    reportProblem({ area: "payment watching", message: line, severity: "critical" });
    return { outcome: "NOTHING_CREDITABLE", unsettledUsdc, remainingNgn };
  }

  const unsettled = confirmed.filter((o) => !o.settledPaymentId);
  if (unsettled.length === 0) {
    console.error(
      `[paymentWatch] ${pa.address}: ${unsettledUsdc.toFixed(2)} ${pa.tokenSymbol} is ` +
        `unsettled but no transfer is unstamped. The two are derived from the same list, ` +
        `so this means the address document is inconsistent.`
    );
    return { outcome: "NOTHING_CREDITABLE", unsettledUsdc, remainingNgn };
  }
  const keyTx = unsettled[unsettled.length - 1];

  const overpaidUnits = fullyPaid ? maxUnits(0n, unsettledUnits - expectedUnits) : 0n;
  const overpaidUsdc = unitsToNumber(overpaidUnits, decimals);
  const noteThreshold = decimalToUnits(NOTE_THRESHOLD, decimals);
  const isLate = unsettled.some((o) => o.late);
  const quoted = pa.quote && pa.quote.expectedUsdc != null ? pa.quote.expectedUsdc : null;
  const quotedUnits = quoted != null ? decimalToUnits(Number(quoted) || 0, decimals) : null;

  const noteParts = [
    `${unsettledUsdc.toFixed(2)} ${pa.tokenSymbol} received on ${chain.name}`,
    `rate ${pa.ngnPerUsd.toLocaleString("en-NG")} naira per ${pa.tokenSymbol}`,
  ];
  if (quotedUnits != null && (quotedUnits > unsettledUnits ? quotedUnits - unsettledUnits : unsettledUnits - quotedUnits) > noteThreshold) {
    noteParts.push(
      `quoted ${quoted.toFixed(2)} ${pa.tokenSymbol} at issue` +
        (pa.quote.reconstructed ? " (reconstructed, not a record)" : "")
    );
  }
  if (isLate) {
    noteParts.push("paid after the address expired");
  }
  if (overpaidUnits > noteThreshold) {
    noteParts.push(
      `overpaid by ${overpaidUsdc.toFixed(2)} ${pa.tokenSymbol} ` +
        `(about ${Math.round(koboToNaira(unitsToKobo(overpaidUnits, decimals, pa.ngnPerUsd))).toLocaleString("en-NG")} naira)`
    );
  }

  let payment;
  try {
    payment = await Payment.create({
      debtId: debt._id,
      userId: pa.userId,
      amount: creditNgn,
      amountKobo: creditKobo,
      method: "crypto",
      note: noteParts.join(", "),
      txHash: keyTx.txHash,
      txHashes: unsettled.map((o) => o.txHash),
    });
  } catch (err) {
    if (err && err.code === 11000) {
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

  unsettled.forEach((o) => {
    o.settledPaymentId = payment._id;
  });

  const priorSettledKobo = Number.isSafeInteger(pa.settledKobo) ? pa.settledKobo : nairaToKobo(pa.settledNgn || 0);
  pa.receivedUsdc = totalUsdc;
  pa.settledKobo = priorSettledKobo + creditKobo;
  pa.settledNgn = koboToNaira(pa.settledKobo);
  pa.overpaidUsdc = unitsToNumber(decimalToUnits(Number(pa.overpaidUsdc) || 0, decimals) + overpaidUnits, decimals);

  if (fullyPaid) {
    pa.status = "paid";
  }
  try {
    await pa.save();
  } catch (err) {
    const line =
      `SETTLED payment ${payment._id} for ${pa.address} but could not save the ` +
      `address stamps (${err.message}). Hashes ${unsettled.map((o) => o.txHash).join(",")}. ` +
      `They will be repaired on the next pass; nothing will be credited twice.`;
    console.error(`[paymentWatch] ${line}`);
    reportProblem({ area: "payment watching", message: line, severity: "critical" });
  }

  if (!fullyPaid) await resyncActivePaymentAddress(debt._id);

  await recomputeDebtStatus(debt);

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
  })
    .then((res) => {
      if (res && res.emailed === false) {
        console.warn(
          `[paymentWatch] invoice ${debt._id} settled but no receipt reached ` +
            `${debt.debtorName}: ${res.reason || "unknown reason"}`
        );
      }
    })
    .catch((err) => {
      console.error("[paymentWatch] settlement event failed:", err.message);
      reportProblem({
        area: "payment watching",
        message: `Invoice ${debt._id} settled, but its receipt and notices failed: ${err.message}`,
        detail: err.stack,
      });
    });

  return { payment, fullyPaid, totalUsdc, creditNgn };
}


async function scanAddress(pa, chain, head, mode = "active") {
  const decimals = await tokenDecimals(chain, pa.tokenContract, pa.tokenDecimals);
  if (decimals !== pa.tokenDecimals) pa.tokenDecimals = decimals;

  pa.lastWatchedAt = new Date();

  const span = spanFor(chain);
  const windows = [];
  let scanning = true;

  if (mode === "grace") {
    const live = await tokenBalanceUnits(chain, pa.tokenContract, pa.address);
    const hasNewMoney = live !== null && live > accountedUnits(pa) + 1n;

    const awaitingConfirmation = pa.observed.some((o) => o.status === "detected");
    if (!hasNewMoney && !awaitingConfirmation) return { found: 0, newlyConfirmed: 0, late: 0 };

    if (hasNewMoney) {
      const blockTime = blockTimeFor(chain.chainId);
      const needed = Math.ceil((GRACE_SCAN_MINUTES * 60) / blockTime) + GRACE_OVERLAP_BLOCKS;
      const covered = Math.min(needed, span * GRACE_MAX_WINDOWS);
      if (covered < needed) {
        console.warn(
          `[paymentWatch] ${chain.name}: grace window covers ${covered} blocks of the ` +
            `${needed} an hour needs (span ${span}). Transfers older than ` +
            `${Math.round((covered * blockTime) / 60)} minutes will not be found this pass.`
        );
      }
      const oldest = Math.max(0, head - covered + 1);
      for (let lo = oldest; lo <= head; lo += span) {
        windows.push({ from: lo, to: Math.min(head, lo + span - 1) });
      }
    } else {
      scanning = false;
    }
  } else {
    let from;
    if (pa.lastScannedBlock > 0) {
      from = pa.lastScannedBlock + 1;
    } else {
      const ageSec = Math.max(0, (Date.now() - new Date(pa.createdAt || Date.now()).getTime()) / 1000);
      const MAX_FIRST_SCAN_SEC = 96 * 60 * 60;
      const lookback =
        Math.ceil(Math.min(ageSec, MAX_FIRST_SCAN_SEC) / blockTimeFor(chain.chainId)) +
        GRACE_OVERLAP_BLOCKS;
      from = Math.max(0, head - Math.max(lookback, span) + 1);
    }
    for (let n = 0; n < MAX_WINDOWS_PER_PASS && from <= head; n++) {
      const to = Math.min(head, from + span - 1);
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
          address: pa.tokenContract,
          topics: [TRANSFER_TOPIC, null, addressTopic(pa.address)],
          fromBlock: "0x" + w.from.toString(16),
          toBlock: "0x" + w.to.toString(16),
        },
      ]);

      if (!Array.isArray(logs)) {
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
      if (mode === "active") pa.lastScannedBlock = w.to;
    }
  }

  if (mode === "grace" && scanning) {
    if (found === 0) {
      if (!pa.unidentifiedBalanceAt) pa.unidentifiedBalanceAt = new Date();
    } else {
      pa.unidentifiedBalanceAt = null;
    }

    await scanForeignTokens(pa, chain, windows);
  }

  const owner = await User.findById(pa.userId).select("crypto");
  const needed = confirmationsFor(chain.chainId, owner);
  let newlyConfirmed = 0;

  for (const o of pa.observed) {
    if (o.status === "confirmed" || o.status === "orphaned") continue;

    o.confirmations = Math.max(0, head - (o.blockNumber || head) + 1);

    if (o.confirmations >= needed) {
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


async function scanForeignTokens(pa, chain, windows) {
  if (!windows.length) return;

  const expected = String(pa.tokenContract || "").toLowerCase();
  const known = new Set((pa.foreign || []).map((f) => String(f.txHash).toLowerCase()));
  let added = 0;

  for (const w of windows) {
    const logs = await rpc(chain, "eth_getLogs", [
      {
        topics: [TRANSFER_TOPIC, null, addressTopic(pa.address)],
        fromBlock: "0x" + w.from.toString(16),
        toBlock: "0x" + w.to.toString(16),
      },
    ]);

    if (!Array.isArray(logs)) continue;

    for (const log of logs) {
      if (!log || log.removed) continue;
      const contract = String(log.address || "").toLowerCase();
      if (!contract || contract === expected) continue;
      const hash = String(log.transactionHash || "").toLowerCase();
      if (!hash || known.has(hash)) continue;

      known.add(hash);
      pa.foreign.push({
        txHash: log.transactionHash,
        contract: log.address,
        value: BigInt(log.data || "0x0").toString(),
      });
      added++;
    }
  }

  if (added) {
    console.warn(
      `[paymentWatch] ${added} transfer(s) of a DIFFERENT token arrived at ${pa.address} ` +
        `on ${chain.name}. Recorded on the invoice; they cannot settle it, and the sweep ` +
        "moves only the quoted token, so recovering them needs the owner."
    );
    await notifyActivity(pa.userId, {
      category: "moneyIn",
      tag: `foreign-${pa._id}`,
      url: "/app/receivables",
      title: "The wrong token arrived on an invoice",
      body:
        "Someone sent a token this invoice does not accept. It is safe at the invoice " +
        "address and is shown on the invoice, but it cannot settle it.",
    }).catch(() => {});
  }
}

async function runPaymentWatchPass({ userId } = {}) {
  const passStartedAt = Date.now();

  const expiredNow = await expireDueAddresses({ userId });

  const now = new Date();
  const activeQuery = { status: "active", expiresAt: { $gt: now } };

  const graceCutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000);
  const staleCutoff = new Date(Date.now() - GRACE_SCAN_MINUTES * 60 * 1000);
  const graceQuery = {
    status: { $in: ["expired", "paid", "revoked"] },
    $and: [
      {
        $or: [
          { expiredAt: { $gte: graceCutoff } },
          { expiredAt: null, expiresAt: { $gte: graceCutoff } },
        ],
      },
      { $or: [{ lastWatchedAt: null }, { lastWatchedAt: { $lt: staleCutoff } }] },
    ],
  };

  if (userId) {
    activeQuery.userId = userId;
    graceQuery.userId = userId;
  }

  let addresses;
  let starved = 0;
  try {
    const [live, grace] = await Promise.all([
      PaymentAddress.find(activeQuery).sort({ lastWatchedAt: 1 }).limit(ACTIVE_LIMIT),
      PaymentAddress.find(graceQuery).sort({ lastWatchedAt: 1 }).limit(GRACE_LIMIT),
    ]);
    addresses = [
      ...live.map((pa) => ({ pa, mode: "active" })),
      ...grace.map((pa) => ({ pa, mode: "grace" })),
    ];
    if (live.length >= ACTIVE_LIMIT || grace.length >= GRACE_LIMIT) {
      starved = 1;
      console.warn(
        `[paymentWatch] address caps reached (active ${live.length}/${ACTIVE_LIMIT}, ` +
          `grace ${grace.length}/${GRACE_LIMIT}). The remainder is deferred to later ` +
          `passes, least recently watched first.`
      );
    }
  } catch (err) {
    logOnce("load addresses", err);
    return {
      addressesChecked: 0,
      detected: 0,
      confirmed: 0,
      settled: 0,
      expired: expiredNow,
      capped: 0,
    };
  }

  let detected = 0;
  let confirmed = 0;
  let settled = 0;
  let lateDetected = 0;
  let checked = 0;
  let deferred = 0;

  for (const { pa, mode } of addresses) {
    if (Date.now() - passStartedAt > PASS_BUDGET_MS) {
      deferred = addresses.length - checked;
      console.warn(
        `[paymentWatch] pass budget of ${Math.round(PASS_BUDGET_MS / 1000)}s spent after ` +
          `${checked} address(es); ${deferred} deferred to the next pass, least recently ` +
          `watched first. If this repeats, a chain is slow or an endpoint is timing out.`
      );
      break;
    }
    checked++;
    try {
      const chain = getChain(pa.chainId);
      if (!chain) continue;

      const head = await currentBlock(chain);
      if (!head) continue;

      const res = await scanAddress(pa, chain, head, mode);
      detected += res.found;
      confirmed += res.newlyConfirmed;
      lateDetected += res.late;

      if (res.found > 0) {
        const owner = await User.findById(pa.userId).select("crypto");
        if (!owner || owner.crypto?.notifyOnDetected !== false) {
          await notifyActivity(pa.userId, {
            category: "moneyIn",
            tag: `detect-${pa._id}`,
            url: "/app/receivables",
            symbol: pa.tokenSymbol,
            title: res.late ? "Late payment detected" : "Payment detected",
            body: res.late
              ? `${pa.tokenSymbol} arrived on ${chain.name} after this address expired. Waiting for confirmations.`
              : `${pa.tokenSymbol} arrived on ${chain.name}. Waiting for confirmations.`,
          }).catch(() => {});
        }
      }

      await pa.save();

      const outcome = await settleIfDue(pa, chain);
      if (outcome && outcome.payment) settled++;
    } catch (err) {
      logOnce(`address ${pa._id}`, err);
    }
  }

  return {
    addressesChecked: checked,
    detected,
    confirmed,
    settled,
    expired: expiredNow,
    late: lateDetected,
    capped: starved,
    deferred,
  };
}

module.exports = {
  runPaymentWatchPass,
  expireDueAddresses,
  settleIfDue,
  scanAddress,
  unitsToAmount,
  toleratedShortfall,
  toleratedShortfallUnits,
  accountedUnits,
  confirmedUnsweptUnits,
  tokenBalanceUnits,
  MAX_SHORTFALL,
  accountedOnChain,
  tokenBalance,
  addressTopic,
  TRANSFER_TOPIC,
  TOLERANCE,
};
