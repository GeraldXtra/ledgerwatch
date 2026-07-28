const Debt = require("../models/Debt");
const Payment = require("../models/Payment");
const Reminder = require("../models/Reminder");
const { normalizePhone } = require("../utils/phone");

const DAY_MS = 24 * 60 * 60 * 1000;

// ---- payment totals + derived fields --------------------------------------

/**
 * Sum of payments per debtId for a set of debts (one grouped query).
 * @returns {Promise<Map<string, number>>} debtId -> amountPaid
 */
async function paidByDebt(userId, debtIds) {
  if (!debtIds.length) return new Map();
  const rows = await Payment.aggregate([
    { $match: { userId, debtId: { $in: debtIds } } },
    { $group: { _id: "$debtId", paid: { $sum: "$amount" } } },
  ]);
  const map = new Map();
  for (const r of rows) map.set(String(r._id), r.paid);
  return map;
}

/**
 * Derived status for display. Stored status is pending|partially_paid|paid;
 * "overdue" is derived (balance>0 && dueDate<now). Respects a stored "paid" flag
 * so a written-off debt still reads paid.
 */
function displayStatus(debt, balance) {
  if (debt.status === "paid" || balance <= 0) return "paid";
  if (new Date(debt.dueDate).getTime() < Date.now()) return "overdue";
  if (balance < debt.amount) return "partially_paid";
  return "pending";
}

/**
 * Attach amountPaid / balance / displayStatus to a plain debt object.
 */
function withDerived(debt, amountPaid) {
  const obj = typeof debt.toObject === "function" ? debt.toObject() : { ...debt };
  const paid = amountPaid || 0;
  const balance = Math.max(0, (obj.amount || 0) - paid);
  obj.amountPaid = paid;
  obj.balance = balance;
  obj.displayStatus = displayStatus(obj, balance);
  return obj;
}

/**
 * Attach derived fields to an array of debt docs using one aggregation.
 */
async function attachTotals(userId, debts) {
  const ids = debts.map((d) => d._id);
  const map = await paidByDebt(userId, ids);
  return debts.map((d) => withDerived(d, map.get(String(d._id)) || 0));
}

/**
 * Recompute a debt's stored status after a payment change, and cancel scheduled
 * reminders when it reaches zero. Mutates + saves the debt. Returns amountPaid.
 */
async function recomputeDebtStatus(debt) {
  const rows = await Payment.aggregate([
    { $match: { debtId: debt._id } },
    { $group: { _id: null, paid: { $sum: "$amount" } } },
  ]);
  const amountPaid = rows.length ? rows[0].paid : 0;
  const balance = (debt.amount || 0) - amountPaid;

  const wasPaid = debt.status === "paid";
  if (balance <= 0) {
    debt.status = "paid";
    if (!wasPaid) debt.history.push({ event: "marked_paid" });
  } else if (amountPaid > 0) {
    debt.status = "partially_paid";
  } else {
    debt.status = "pending";
  }
  await debt.save();

  // Reaching zero cancels any scheduled reminders (same as manual mark-paid).
  if (balance <= 0 && !wasPaid) {
    await Reminder.updateMany(
      { debtId: debt._id, userId: debt.userId, status: "scheduled" },
      { $set: { status: "cancelled" } }
    );
  }
  return amountPaid;
}

// ---- debtor grouping + reliability ----------------------------------------

// Group key: normalized international phone if valid, else name:<lowercased>.
function debtorKey(debt) {
  const norm = normalizePhone(debt.debtorPhone);
  if (norm.valid) return norm.intl;
  return `name:${(debt.debtorName || "").trim().toLowerCase()}`;
}

/**
 * When a debt is fully settled, the date it reached zero (last payment) — else null.
 */
function settledDate(debt, payments) {
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  if (paid < debt.amount) return null;
  const dates = payments.map((p) => new Date(p.paidAt).getTime());
  return dates.length ? new Date(Math.max(...dates)) : null;
}

/**
 * Reliability score 0-100 from on-time rate (50%), completion rate (30%),
 * lateness factor (20%). Band: Excellent/Good/Fair/Risky, or New (no completed debts).
 */
function reliabilityScore({ debts, paymentsByDebt }) {
  let paidCount = 0;
  let onTime = 0;
  let latenessSum = 0;
  let totalBorrowed = 0;
  let totalCollected = 0;

  for (const d of debts) {
    const pays = paymentsByDebt.get(String(d._id)) || [];
    const collected = pays.reduce((s, p) => s + p.amount, 0);
    totalBorrowed += d.amount || 0;
    totalCollected += Math.min(collected, d.amount || 0);

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

/**
 * Build grouped debtor summaries for a user.
 */
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
      const collected = pays.reduce((s, p) => s + p.amount, 0);
      totalBorrowed += d.amount || 0;
      totalOutstanding += Math.max(0, (d.amount || 0) - collected);

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
      totalBorrowed,
      totalOutstanding,
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

/**
 * Full debtor profile: stats + debts (with derived) + chronological timeline.
 */
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
  const derivedDebts = debts.map((d) =>
    withDerived(d, (paymentsByDebt.get(String(d._id)) || []).reduce((s, p) => s + p.amount, 0))
  );

  // Timeline (chronological, all event types).
  const timeline = [];
  for (const d of debts) {
    timeline.push({ type: "debt_created", at: d.createdAt, debtId: d._id, amount: d.amount, note: d.note });
  }
  for (const p of payments) {
    timeline.push({ type: "payment", at: p.paidAt, debtId: p.debtId, amount: p.amount, method: p.method });
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

// ---- analytics ------------------------------------------------------------

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
    paidMap.set(String(p.debtId), (paidMap.get(String(p.debtId)) || 0) + p.amount);
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
    const balance = Math.max(0, (d.amount || 0) - paid);
    totalBorrowed += d.amount || 0;
    totalCollected += Math.min(paid, d.amount || 0);
    totalOutstanding += balance;

    const ds = displayStatus(d, balance);
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

  // Collected this month (payments made this calendar month).
  const collectedThisMonth = payments
    .filter((p) => {
      const at = new Date(p.paidAt);
      return at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth();
    })
    .reduce((s, p) => s + p.amount, 0);

  // 6-month series: owed = debts created that month; collected = payments made that month.
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: monthKey(d), label: d.toLocaleDateString("en-US", { month: "short" }), owed: 0, collected: 0 });
  }
  const monthIndex = new Map(months.map((m, i) => [m.key, i]));
  for (const d of debts) {
    const idx = monthIndex.get(monthKey(d.createdAt));
    if (idx != null) months[idx].owed += d.amount || 0;
  }
  for (const p of payments) {
    const idx = monthIndex.get(monthKey(p.paidAt));
    if (idx != null) months[idx].collected += p.amount || 0;
  }

  return {
    totalOutstanding,
    collectedThisMonth,
    collectionRate: totalBorrowed ? Math.round((totalCollected / totalBorrowed) * 100) : 0,
    avgDaysToPayment: settledCount ? Math.round(daysToPaySum / settledCount) : null,
    countByStatus,
    monthly: months.map((m) => ({ month: m.label, owed: m.owed, collected: m.collected })),
    aging,
  };
}

module.exports = {
  attachTotals,
  withDerived,
  recomputeDebtStatus,
  debtorKey,
  debtorGroups,
  debtorProfile,
  analytics,
  reliabilityScore,
};
