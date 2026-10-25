const Debt = require("../models/Debt");
const Payment = require("../models/Payment");
const Reminder = require("../models/Reminder");
const { normalizePhone } = require("../utils/phone");
const mongoose = require("mongoose");
const { koboOf, koboToNaira, nairaToKobo, shareOf } = require("../domain/money");

const DAY_MS = 24 * 60 * 60 * 1000;

const PAYMENT_KOBO = {
  $ifNull: ["$amountKobo", { $floor: { $add: [{ $multiply: ["$amount", 100] }, 0.5] } }],
};

async function paidKoboForDebt(debtId) {
  const rows = await Payment.aggregate([
    { $match: { debtId: toObjectId(debtId) } },
    { $group: { _id: null, paid: { $sum: PAYMENT_KOBO } } },
  ]);
  return rows.length ? rows[0].paid : 0;
}

async function paidForDebt(debtId) {
  return koboToNaira(await paidKoboForDebt(debtId));
}

function toObjectId(value) {
  if (value && typeof value === "object") return value;
  return new mongoose.Types.ObjectId(String(value));
}

async function paidKoboByDebt(userId, debtIds) {
  if (!debtIds.length) return new Map();
  const rows = await Payment.aggregate([
    { $match: { userId, debtId: { $in: debtIds } } },
    { $group: { _id: "$debtId", paid: { $sum: PAYMENT_KOBO } } },
  ]);
  const map = new Map();
  for (const r of rows) map.set(String(r._id), r.paid);
  return map;
}

function displayStatus(debt, balanceKobo, amountKobo) {
  if (debt.status === "paid" || balanceKobo <= 0) return "paid";
  if (new Date(debt.dueDate).getTime() < Date.now()) return "overdue";
  if (balanceKobo < amountKobo) return "partially_paid";
  return "pending";
}

function withDerivedKobo(debt, paidKobo) {
  const obj = typeof debt.toObject === "function" ? debt.toObject() : { ...debt };
  const amountKobo = koboOf(obj);
  const paid = Math.max(0, Math.round(Number(paidKobo) || 0));
  const balanceKobo = Math.max(0, amountKobo - paid);
  obj.amountKobo = amountKobo;
  obj.amount = koboToNaira(amountKobo);
  obj.amountPaidKobo = paid;
  obj.amountPaid = koboToNaira(paid);
  obj.balanceKobo = balanceKobo;
  obj.balance = koboToNaira(balanceKobo);
  obj.displayStatus = displayStatus(obj, balanceKobo, amountKobo);
  return obj;
}

function withDerived(debt, amountPaid) {
  return withDerivedKobo(debt, nairaToKobo(amountPaid || 0));
}

async function attachTotals(userId, debts) {
  const ids = debts.map((d) => d._id);
  const map = await paidKoboByDebt(userId, ids);
  return debts.map((d) => withDerivedKobo(d, map.get(String(d._id)) || 0));
}

function toleratedShortfallKobo(invoiceKobo) {
  const tolerance = Number(process.env.USDC_SETTLEMENT_TOLERANCE || 0.005);
  const maxDustNgn = Number(process.env.SETTLEMENT_MAX_DUST_NGN || 100);
  const proportional = Number(shareOf(BigInt(Math.max(0, Math.round(Number(invoiceKobo) || 0))), tolerance));
  const cap = Number.isFinite(maxDustNgn) && maxDustNgn >= 0 ? nairaToKobo(maxDustNgn) : 0;
  return Math.min(proportional, cap);
}

async function recomputeDebtStatus(debt) {
  const paidKobo = await paidKoboForDebt(debt._id);
  const amountKobo = koboOf(debt);
  const balanceKobo = amountKobo - paidKobo;
  const amountPaid = koboToNaira(paidKobo);

  const settled = balanceKobo <= toleratedShortfallKobo(amountKobo);

  const wasPaid = debt.status === "paid";
  if (settled) {
    debt.status = "paid";
    if (!wasPaid) debt.history.push({ event: "marked_paid" });
  } else if (amountPaid > 0) {
    debt.status = "partially_paid";
  } else {
    debt.status = "pending";
  }
  await debt.save();

  if (settled && !wasPaid) {
    await Reminder.updateMany(
      { debtId: debt._id, userId: debt.userId, status: "scheduled" },
      { $set: { status: "cancelled" } }
    );
  }
  return amountPaid;
}

function debtorKey(debt) {
  const norm = normalizePhone(debt.debtorPhone);
  if (norm.valid) return norm.intl;
  return `name:${(debt.debtorName || "").trim().toLowerCase()}`;
}

function sumPaymentsKobo(payments) {
  return (payments || []).reduce((s, p) => s + koboOf(p), 0);
}

function settledDate(debt, payments) {
  const amountKobo = koboOf(debt);
  if (sumPaymentsKobo(payments) < amountKobo - toleratedShortfallKobo(amountKobo)) return null;
  const dates = payments.map((p) => new Date(p.paidAt).getTime());
  return dates.length ? new Date(Math.max(...dates)) : null;
}

function reliabilityScore({ debts, paymentsByDebt }) {
  let paidCount = 0;
  let onTime = 0;
  let latenessSum = 0;
  let totalBorrowed = 0;
  let totalCollected = 0;

  for (const d of debts) {
    const pays = paymentsByDebt.get(String(d._id)) || [];
    const collected = sumPaymentsKobo(pays);
    const owed = koboOf(d);
    totalBorrowed += owed;
    totalCollected += Math.min(collected, owed);

    const settled = settledDate(d, pays);
    if (settled) {
      paidCount++;
      const lateDays = Math.max(
        0,
        Math.floor((settled.getTime() - new Date(d.dueDate).getTime()) / DAY_MS)
      );
      if (lateDays === 0) onTime++;
      latenessSum += lateDays;
    }
  }

  if (paidCount === 0) {
    return { score: null, band: "New", onTimeRate: null, completionRate: totalBorrowed ? totalCollected / totalBorrowed : 0, avgLatenessDays: null };
  }

  const onTimeRate = onTime / paidCount;
  const completionRate = totalBorrowed ? totalCollected / totalBorrowed : 0;
  const avgLatenessDays = latenessSum / paidCount;
  const latenessFactor = Math.max(0, Math.min(1, 1 - avgLatenessDays / 30));

  const score = Math.round(
    100 * (0.5 * onTimeRate + 0.3 * completionRate + 0.2 * latenessFactor)
  );
  let band = "Risky";
  if (score >= 80) band = "Excellent";
  else if (score >= 60) band = "Good";
  else if (score >= 40) band = "Fair";

  return { score, band, onTimeRate, completionRate, avgLatenessDays };
}

async function debtorGroups(userId) {
  const debts = await Debt.find({ userId }).sort({ createdAt: -1 });
  const ids = debts.map((d) => d._id);
  const payments = await Payment.find({ userId, debtId: { $in: ids } });

  const paymentsByDebt = new Map();
  for (const p of payments) {
    const k = String(p.debtId);
    if (!paymentsByDebt.has(k)) paymentsByDebt.set(k, []);
    paymentsByDebt.get(k).push(p);
  }

  const groups = new Map();
  for (const d of debts) {
    const key = debtorKey(d);
    if (!groups.has(key)) {
      groups.set(key, { key, debtorName: d.debtorName, debtorPhone: d.debtorPhone, debts: [] });
    }
    groups.get(key).debts.push(d);
  }

  const out = [];
  for (const g of groups.values()) {
    let totalBorrowed = 0;
    let totalOutstanding = 0;
    let daysToPaySum = 0;
    let paidCount = 0;
    let lastActivityAt = null;

    for (const d of g.debts) {
      const pays = paymentsByDebt.get(String(d._id)) || [];
      const collected = sumPaymentsKobo(pays);
      const owed = koboOf(d);
      totalBorrowed += owed;
      totalOutstanding += Math.max(0, owed - collected);

      const settled = settledDate(d, pays);
      if (settled) {
        paidCount++;
        daysToPaySum += Math.max(
          0,
          Math.round((settled.getTime() - new Date(d.createdAt).getTime()) / DAY_MS)
        );
      }
      const activity = [new Date(d.createdAt).getTime(), ...pays.map((p) => new Date(p.paidAt).getTime())];
      const latest = Math.max(...activity);
      if (lastActivityAt == null || latest > lastActivityAt) lastActivityAt = latest;
    }

    const rel = reliabilityScore({ debts: g.debts, paymentsByDebt });
    out.push({
      key: g.key,
      debtorName: g.debtorName,
      debtorPhone: g.debtorPhone,
      debtCount: g.debts.length,
      totalBorrowed: koboToNaira(totalBorrowed),
      totalOutstanding: koboToNaira(totalOutstanding),
      avgDaysToPay: paidCount ? Math.round(daysToPaySum / paidCount) : null,
      onTimeRate: rel.onTimeRate,
      completionRate: rel.completionRate,
      reliabilityScore: rel.score,
      band: rel.band,
      lastActivityAt: lastActivityAt ? new Date(lastActivityAt) : null,
    });
  }

  out.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  return out;
}

async function debtorProfile(userId, key) {
  const allDebts = await Debt.find({ userId }).sort({ createdAt: 1 });
  const debts = allDebts.filter((d) => debtorKey(d) === key);
  if (debts.length === 0) return null;

  const ids = debts.map((d) => d._id);
  const payments = await Payment.find({ userId, debtId: { $in: ids } }).sort({ paidAt: 1 });
  const reminders = await Reminder.find({ userId, debtId: { $in: ids } }).sort({ createdAt: 1 });

  const paymentsByDebt = new Map();
  for (const p of payments) {
    const k = String(p.debtId);
    if (!paymentsByDebt.has(k)) paymentsByDebt.set(k, []);
    paymentsByDebt.get(k).push(p);
  }
  const derivedDebts = debts.map((d) => withDerivedKobo(d, sumPaymentsKobo(paymentsByDebt.get(String(d._id)))));

  const timeline = [];
  for (const d of debts) {
    timeline.push({ type: "debt_created", at: d.createdAt, debtId: d._id, amount: koboToNaira(koboOf(d)), note: d.note });
  }
  for (const p of payments) {
    timeline.push({ type: "payment", at: p.paidAt, debtId: p.debtId, amount: koboToNaira(koboOf(p)), method: p.method });
  }
  for (const r of reminders) {
    timeline.push({ type: "reminder", at: r.createdAt, debtId: r.debtId, status: r.status });
  }
  timeline.sort((a, b) => new Date(a.at) - new Date(b.at));

  const summary = (await debtorGroups(userId)).find((g) => g.key === key) || {
    key,
    debtorName: debts[0].debtorName,
    debtorPhone: debts[0].debtorPhone,
  };

  return { debtor: summary, debts: derivedDebts, timeline };
}

function monthKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function analytics(userId) {
  const debts = await Debt.find({ userId });
  const ids = debts.map((d) => d._id);
  const payments = await Payment.find({ userId, debtId: { $in: ids } });

  const paidMap = new Map();
  for (const p of payments) {
    paidMap.set(String(p.debtId), (paidMap.get(String(p.debtId)) || 0) + koboOf(p));
  }

  const now = new Date();
  let totalOutstanding = 0;
  let totalBorrowed = 0;
  let totalCollected = 0;
  const countByStatus = { pending: 0, partially_paid: 0, paid: 0, overdue: 0 };
  const aging = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  let daysToPaySum = 0;
  let settledCount = 0;

  const paysByDebt = new Map();
  for (const p of payments) {
    const k = String(p.debtId);
    if (!paysByDebt.has(k)) paysByDebt.set(k, []);
    paysByDebt.get(k).push(p);
  }

  for (const d of debts) {
    const paid = paidMap.get(String(d._id)) || 0;
    const owed = koboOf(d);
    const balance = Math.max(0, owed - paid);
    totalBorrowed += owed;
    totalCollected += Math.min(paid, owed);
    totalOutstanding += balance;

    const ds = displayStatus(d, balance, owed);
    countByStatus[ds] = (countByStatus[ds] || 0) + 1;

    if (balance > 0) {
      const overdueDays = Math.floor((now.getTime() - new Date(d.dueDate).getTime()) / DAY_MS);
      if (overdueDays <= 0) aging.current += balance;
      else if (overdueDays <= 30) aging.d1_30 += balance;
      else if (overdueDays <= 60) aging.d31_60 += balance;
      else if (overdueDays <= 90) aging.d61_90 += balance;
      else aging.d90plus += balance;
    }

    const settled = settledDate(d, paysByDebt.get(String(d._id)) || []);
    if (settled) {
      settledCount++;
      daysToPaySum += Math.max(0, Math.round((settled.getTime() - new Date(d.createdAt).getTime()) / DAY_MS));
    }
  }

  const collectedThisMonth = payments
    .filter((p) => {
      const at = new Date(p.paidAt);
      return at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth();
    })
    .reduce((s, p) => s + koboOf(p), 0);

  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: monthKey(d), label: d.toLocaleDateString("en-US", { month: "short" }), owed: 0, collected: 0 });
  }
  const monthIndex = new Map(months.map((m, i) => [m.key, i]));
  for (const d of debts) {
    const idx = monthIndex.get(monthKey(d.createdAt));
    if (idx != null) months[idx].owed += koboOf(d);
  }
  for (const p of payments) {
    const idx = monthIndex.get(monthKey(p.paidAt));
    if (idx != null) months[idx].collected += koboOf(p);
  }

  return {
    totalOutstanding: koboToNaira(totalOutstanding),
    collectedThisMonth: koboToNaira(collectedThisMonth),
    collectionRate: totalBorrowed ? Math.round((totalCollected / totalBorrowed) * 100) : 0,
    avgDaysToPayment: settledCount ? Math.round(daysToPaySum / settledCount) : null,
    countByStatus,
    monthly: months.map((m) => ({ month: m.label, owed: koboToNaira(m.owed), collected: koboToNaira(m.collected) })),
    aging: Object.fromEntries(Object.entries(aging).map(([k, v]) => [k, koboToNaira(v)])),
  };
}

module.exports = {
  paidForDebt,
  paidKoboForDebt,
  attachTotals,
  withDerived,
  withDerivedKobo,
  recomputeDebtStatus,
  toleratedShortfallKobo,
  debtorKey,
  debtorGroups,
  debtorProfile,
  analytics,
  reliabilityScore,
};
