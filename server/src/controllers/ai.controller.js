const Debt = require("../models/Debt");
const Watch = require("../models/Watch");
const {
  answerReceivablesQuery,
  marketChat,
} = require("../services/anthropic.service");
const { formatAmount } = require("../utils/reminderTemplate");
const { attachTotals } = require("../services/receivables.service");
const {
  createWatch,
  getPortfolio,
  parseWatchCommand,
  buildPortfolioSummaryText,
} = require("../services/market.service");
const { supportedSymbols } = require("../services/coinMap");
const { getPrices } = require("../services/coingecko.service");

const DAY_MS = 24 * 60 * 60 * 1000;
// A question for the agent is a sentence or two. Everything past this is paid
// for per token at the provider and buys nothing; it was unbounded, and a
// non-string body value reached `.trim()` and answered 500.
const MAX_PROMPT_CHARS = 2000;

/**
 * Deterministic, no-AI answer over the user's debts. Never crashes.
 * Summarizes top debtor, total outstanding, and the most overdue open debt.
 *
 * WHAT WAS WRONG WITH IT, AND WHY IT MATTERED (LW-011).
 *
 * It did three things, and all three understated or overstated what the owner
 * is actually owed:
 *
 *  1. It filtered on `status === "pending"`, so every PARTLY PAID invoice was
 *     dropped from the answer entirely. Those are precisely the ones somebody
 *     asks about.
 *  2. It summed `d.amount`, the GROSS invoice value, as though it were the
 *     balance. A one million naira invoice with nine hundred thousand already
 *     paid contributed either nothing (dropped by 1) or a million (if still
 *     pending) — never the hundred thousand actually outstanding. CLAUDE.md
 *     names this exact pattern: never treat a stored gross figure as a net one.
 *  3. It added figures in different currencies together and labelled the sum
 *     with whichever single invoice happened to be largest.
 *
 * The analytics page computed the same number correctly, so the two screens
 * gave irreconcilable answers to the same question and neither said why.
 *
 * `debts` here are the plain objects `attachTotals` produces, which carry
 * `balance` — the one figure that means "still owed".
 */
function computeFallback(debts) {
  const open = debts.filter((d) => (d.balance || 0) > 0 && d.status !== "paid");

  if (open.length === 0) {
    return "You have no outstanding invoices. Everyone is settled up.";
  }

  // Totalled PER CURRENCY. Adding naira to dollars produces a number that is
  // not an amount of anything.
  const byCurrency = new Map();
  for (const d of open) {
    const cur = d.currency || "NGN";
    byCurrency.set(cur, (byCurrency.get(cur) || 0) + (d.balance || 0));
  }
  const totals = [...byCurrency.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cur, sum]) => formatAmount(sum, cur))
    .join(" and ");

  const topByBalance = [...open].sort((a, b) => (b.balance || 0) - (a.balance || 0))[0];

  const now = Date.now();
  const overdue = open
    .filter((d) => new Date(d.dueDate).getTime() < now)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  const lines = [];
  lines.push(`You have ${open.length} unpaid invoice(s) with ${totals} still outstanding.`);
  lines.push(
    `Owes the most: ${topByBalance.debtorName} — ${formatAmount(
      topByBalance.balance,
      topByBalance.currency
    )} of ${formatAmount(topByBalance.amount, topByBalance.currency)}.`
  );
  if (overdue.length) {
    const worst = overdue[0];
    const days = Math.floor((now - new Date(worst.dueDate).getTime()) / DAY_MS);
    lines.push(
      `Most overdue: ${worst.debtorName} (${days} day(s) past due, ${formatAmount(
        worst.balance,
        worst.currency
      )} outstanding).`
    );
  } else {
    lines.push("None of your unpaid invoices are overdue yet.");
  }

  return lines.join(" ");
}

// POST /api/ai/receivables-query
async function receivablesQuery(req, res) {
  try {
    const question = String((req.body && req.body.question) || "").slice(0, MAX_PROMPT_CHARS);
    if (!question.trim()) {
      return res.status(400).json({ error: "question is required" });
    }

    const raw = await Debt.find({ userId: req.user._id });
    /**
     * THE BALANCE, NOT JUST THE INVOICE VALUE.
     *
     * `Debt` stores the gross amount and a status; what is still owed is derived
     * at read time and lives nowhere on the document. The summary handed to the
     * model carried `amount` and `status` and nothing else, so the model was
     * being asked what the owner is owed while being shown only what the owner
     * once invoiced. It could not answer correctly, and it answered anyway.
     */
    const debts = await attachTotals(req.user._id, raw);

    // Compact summary for the AI (avoid leaking internal fields).
    const summary = debts.map((d) => ({
      debtorName: d.debtorName,
      amount: d.amount,
      amountPaid: d.amountPaid,
      balance: d.balance,
      currency: d.currency,
      dueDate: d.dueDate,
      status: d.displayStatus || d.status,
      remindedCount: (d.history || []).filter((h) => h.event === "reminded").length,
    }));

    const aiAnswer = await answerReceivablesQuery(question, summary);
    if (aiAnswer) {
      return res.json({ answer: aiAnswer, source: "ai" });
    }

    return res.json({ answer: computeFallback(debts), source: "computed" });
  } catch (err) {
    console.error("receivablesQuery error:", err.message);
    return res.status(500).json({ error: "Failed to answer query" });
  }
}

// Execute a list of watch intents; returns { created, notes }.
async function executeWatchIntents(userId, intents, mode = "paper") {
  const created = [];
  const notes = [];
  for (const intent of intents || []) {
    try {
      const watch = await createWatch(userId, {
        symbol: intent.symbol,
        type: intent.type,
        value: intent.value,
      }, mode);
      created.push(watch);
    } catch (err) {
      notes.push(err.message || `Could not watch ${intent.symbol}`);
    }
  }
  return { created, notes };
}

// POST /api/ai/chat  body: { message }
// Market agent: parses "watch ..." commands into intents the backend executes,
// and answers portfolio questions. Falls back to a basic parser + computed
// summary with NO AI. Never crashes.
async function chat(req, res) {
  try {
    const message = String((req.body && req.body.message) || "").slice(0, MAX_PROMPT_CHARS);
    if (!message.trim()) {
      return res.status(400).json({ error: "message is required" });
    }

    // Build context from the user's real data.
    const [watches, portfolio] = await Promise.all([
      Watch.find({ userId: req.user._id, active: true, mode: req.user.tradingMode === "live" ? "live" : "paper" }),
      getPortfolio(req.user._id, req.user.tradingMode === "live" ? "live" : "paper"),
    ]);
    const coinIds = [...new Set(watches.map((w) => w.coinId))];
    const prices = coinIds.length ? await getPrices(coinIds) : {};

    const context = {
      watches: watches.map((w) => ({
        symbol: w.symbol,
        coinId: w.coinId,
        condition: w.condition,
        baselinePrice: w.baselinePrice,
      })),
      portfolio,
      prices,
      supportedSymbols: supportedSymbols(),
    };

    // Try the AI agent first.
    const aiResult = await marketChat(message, context);
    if (aiResult && typeof aiResult === "object") {
      const { created, notes } = await executeWatchIntents(
        req.user._id,
        aiResult.watches,
        req.user.tradingMode === "live" ? "live" : "paper"
      );
      let reply = aiResult.reply || "";
      if (created.length) {
        reply +=
          (reply ? " " : "") +
          `Now watching: ${created.map((w) => w.symbol).join(", ")}.`;
      }
      if (notes.length) reply += (reply ? " " : "") + notes.join(" ");
      return res.json({ reply: reply.trim(), createdWatches: created, source: "ai" });
    }

    // No-AI fallback.
    const intents = parseWatchCommand(message);
    if (intents.length) {
      const { created, notes } = await executeWatchIntents(req.user._id, intents, req.user.tradingMode === "live" ? "live" : "paper");
      let reply = created.length
        ? `Now watching: ${created.map((w) => w.symbol).join(", ")}.`
        : "";
      if (notes.length) reply += (reply ? " " : "") + notes.join(" ");
      if (!reply) reply = "I could not find a supported coin in that command.";
      return res.json({ reply, createdWatches: created, source: "computed" });
    }

    // Otherwise treat it as a portfolio/status question.
    const answer = await buildPortfolioSummaryText(req.user._id);
    return res.json({ reply: answer, createdWatches: [], source: "computed" });
  } catch (err) {
    console.error("chat error:", err.message);
    return res.status(500).json({ error: "Failed to process chat" });
  }
}

module.exports = { receivablesQuery, chat };
