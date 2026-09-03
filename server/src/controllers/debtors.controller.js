const Payment = require("../models/Payment");
const {
  debtorGroups,
  debtorProfile,
  debtorKey,
} = require("../services/receivables.service");

// GET /api/debtors  (grouped debtor summaries with reliability score)
async function list(req, res) {
  try {
    const debtors = await debtorGroups(req.user._id);
    return res.json({ debtors });
  } catch (err) {
    console.error("list debtors error:", err.message);
    return res.status(500).json({ error: "Failed to list debtors" });
  }
}

// GET /api/debtors/lookup?phone=  (for the Add-Debt inline reliability warning)
async function lookup(req, res) {
  try {
    // Coerced: `?phone[]=x` arrives as an array and `.trim` is not a function.
    const phone = String(req.query.phone || "").trim().slice(0, 40);
    const name = String(req.query.name || "").trim().slice(0, 120);
    if (!phone && !name) return res.json({ debtor: null });

    const groups = await debtorGroups(req.user._id);
    // Match by normalized phone via a synthetic debt, else by name.
    const key = debtorKey({ debtorPhone: phone, debtorName: name });
    const match = groups.find((g) => g.key === key) || null;
    return res.json({ debtor: match });
  } catch (err) {
    console.error("debtor lookup error:", err.message);
    return res.status(500).json({ error: "Failed to look up debtor" });
  }
}

// GET /api/debtors/:key  (full profile: debts + timeline)
async function profile(req, res) {
  try {
    const key = decodeURIComponent(req.params.key);
    const data = await debtorProfile(req.user._id, key);
    if (!data) return res.status(404).json({ error: "Debtor not found" });
    return res.json(data);
  } catch (err) {
    console.error("debtor profile error:", err.message);
    return res.status(500).json({ error: "Failed to load debtor" });
  }
}

// GET /api/debtors/:key/statement  (all debts + payments for one debtor)
async function statement(req, res) {
  try {
    const key = decodeURIComponent(req.params.key);
    const data = await debtorProfile(req.user._id, key);
    if (!data) return res.status(404).json({ error: "Debtor not found" });

    const ids = data.debts.map((d) => d._id);
    const payments = await Payment.find({ userId: req.user._id, debtId: { $in: ids } }).sort({
      paidAt: 1,
    });
    const byDebt = new Map();
    for (const p of payments) {
      const k = String(p.debtId);
      if (!byDebt.has(k)) byDebt.set(k, []);
      byDebt.get(k).push(p);
    }

    const debts = data.debts.map((d) => ({ ...d, payments: byDebt.get(String(d._id)) || [] }));
    const totals = {
      totalBorrowed: debts.reduce((s, d) => s + (d.amount || 0), 0),
      totalPaid: debts.reduce((s, d) => s + (d.amountPaid || 0), 0),
      totalOutstanding: debts.reduce((s, d) => s + (d.balance || 0), 0),
    };

    return res.json({
      statement: {
        businessName: req.user.name,
        debtor: data.debtor,
        debts,
        totals,
        generatedAt: new Date(),
      },
    });
  } catch (err) {
    console.error("statement error:", err.message);
    return res.status(500).json({ error: "Failed to build statement" });
  }
}

module.exports = { list, lookup, profile, statement };
