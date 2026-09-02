const Debt = require("../models/Debt");
const Watch = require("../models/Watch");
const {
  answerReceivablesQuery,
  marketChat,
} = require("../services/anthropic.service");
const { formatAmount } = require("../utils/reminderTemplate");
const {
  createWatch,
  getPortfolio,
  parseWatchCommand,
  buildPortfolioSummaryText,
} = require("../services/market.service");
const { supportedSymbols } = require("../services/coinMap");
const { getPrices } = require("../services/coingecko.service");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deterministic, no-AI answer over the user's debts. Never crashes.
 * Summarizes top debtor, total outstanding, and the most overdue pending debt.
 */
function computeFallback(debts) {
  const pending = debts.filter((d) => d.status === "pending");

  if (pending.length === 0) {
    return "You have no pending debts. Everyone is settled up.";
  }

  const totalOutstanding = pending.reduce((sum, d) => sum + (d.amount || 0), 0);

  const topByAmount = [...pending].sort((a, b) => b.amount - a.amount)[0];

  const now = Date.now();
  const overdue = pending
    .filter((d) => new Date(d.dueDate).getTime() < now)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  const lines = [];
  lines.push(
    `You have ${pending.length} pending debt(s) totalling ${formatAmount(
      totalOutstanding,
      topByAmount.currency
    )}.`
  );
  lines.push(
    `Owes the most: ${topByAmount.debtorName} — ${formatAmount(
      topByAmount.amount,
      topByAmount.currency
    )}.`
  );
  if (overdue.length) {
    const worst = overdue[0];
    const days = Math.floor((now - new Date(worst.dueDate).getTime()) / DAY_MS);
    lines.push(
      `Most overdue: ${worst.debtorName} (${days} day(s) past due, ${formatAmount(
        worst.amount,
        worst.currency
      )}).`
    );
  } else {
    lines.push("None of your pending debts are overdue yet.");
  }

  return lines.join(" ");
}

// POST /api/ai/receivables-query
async function receivablesQuery(req, res) {
  try {
    const question = (req.body && req.body.question) || "";
    if (!question.trim()) {
      return res.status(400).json({ error: "question is required" });
    }

    const debts = await Debt.find({ userId: req.user._id });

    // Compact summary for the AI (avoid leaking internal fields).
    const summary = debts.map((d) => ({
      debtorName: d.debtorName,
      amount: d.amount,
      currency: d.currency,
      dueDate: d.dueDate,
      status: d.status,
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
    const message = (req.body && req.body.message) || "";
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
