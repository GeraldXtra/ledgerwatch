const Debt = require("../models/Debt");
const { requestedMode } = require("../utils/tradingMode");
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
const MAX_PROMPT_CHARS = 2000;

function computeFallback(debts) {
  const open = debts.filter((d) => (d.balance || 0) > 0 && d.status !== "paid");

  if (open.length === 0) {
    return "You have no outstanding invoices. Everyone is settled up.";
  }

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

async function receivablesQuery(req, res) {
  try {
    const question = String((req.body && req.body.question) || "").slice(0, MAX_PROMPT_CHARS);
    if (!question.trim()) {
      return res.status(400).json({ error: "question is required" });
    }

    const raw = await Debt.find({ userId: req.user._id });
    const debts = await attachTotals(req.user._id, raw);

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

async function chat(req, res) {
  try {
    const message = String((req.body && req.body.message) || "").slice(0, MAX_PROMPT_CHARS);
    if (!message.trim()) {
      return res.status(400).json({ error: "message is required" });
    }

    const [watches, portfolio] = await Promise.all([
      Watch.find({ userId: req.user._id, active: true, mode: requestedMode(req) }),
      getPortfolio(req.user._id, requestedMode(req)),
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

    const aiResult = await marketChat(message, context);
    if (aiResult && typeof aiResult === "object") {
      const { created, notes } = await executeWatchIntents(
        req.user._id,
        aiResult.watches,
        requestedMode(req)
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

    const intents = parseWatchCommand(message);
    if (intents.length) {
      const { created, notes } = await executeWatchIntents(req.user._id, intents, requestedMode(req));
      let reply = created.length
        ? `Now watching: ${created.map((w) => w.symbol).join(", ")}.`
        : "";
      if (notes.length) reply += (reply ? " " : "") + notes.join(" ");
      if (!reply) reply = "I could not find a supported coin in that command.";
      return res.json({ reply, createdWatches: created, source: "computed" });
    }

    const answer = await buildPortfolioSummaryText(req.user._id);
    return res.json({ reply: answer, createdWatches: [], source: "computed" });
  } catch (err) {
    console.error("chat error:", err.message);
    return res.status(500).json({ error: "Failed to process chat" });
  }
}

module.exports = { receivablesQuery, chat };
