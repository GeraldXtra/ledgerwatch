const Anthropic = require("@anthropic-ai/sdk");
const { formatDate } = require("../utils/reminderTemplate");

const MODEL = "claude-sonnet-4-6";

const REQUEST_TIMEOUT_MS = Number(process.env.ANTHROPIC_TIMEOUT_MS || 30000);

let client = null;

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    });
  }
  return client;
}

function extractText(response) {
  if (!response || !Array.isArray(response.content)) return null;
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  return text || null;
}

async function draftReminder({
  debtorName,
  amount,
  currency,
  dueDate,
  daysOverdue,
  tone,
  bankDetails,
  ownerName,
}) {
  const anthropic = getClient();
  if (!anthropic) return null;

  const bank = bankDetails && bankDetails.accountNumber
    ? `pay into ${bankDetails.accountName || "my account"}${
        bankDetails.bankName ? `, ${bankDetails.bankName}` : ""
      }, account number ${bankDetails.accountNumber}`
    : "the owner has not set their bank details yet";

  const dueHuman = formatDate(dueDate);
  const situation =
    daysOverdue > 0
      ? `The payment is ${daysOverdue} day(s) overdue. It was due on ${dueHuman}.`
      : `The payment is not yet due. It is due on ${dueHuman}. This is a friendly, upcoming nudge.`;

  const prompt = [
    `Write a short, warm payment reminder message (about 4 to 5 short lines) to a debtor.`,
    `Debtor name: ${debtorName}.`,
    `Amount owed: ${currency || "NGN"} ${amount}.`,
    situation,
    `Tone: ${tone === "firm" ? "firm but polite and human" : "gentle, warm and friendly"}.`,
    `Tell them how to pay: ${bank}.`,
    ownerName ? `Sign off warmly from: ${ownerName}.` : "",
    `IMPORTANT STYLE RULES: Write naturally, like a real person speaking kindly.`,
    `Do NOT use any hyphens, en dashes, or em dashes anywhere. Use only commas and periods.`,
    `Return ONLY the message text, with no preamble and no quotation marks.`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    return extractText(response);
  } catch (err) {
    console.error("draftReminder AI error:", err.message);
    return null;
  }
}

const MAX_DEBT_ROWS = 200;

function trimDebtsForPrompt(debtsSummary) {
  const rows = Array.isArray(debtsSummary) ? debtsSummary : [];
  if (rows.length <= MAX_DEBT_ROWS) return { rows, total: rows.length };
  const ranked = [...rows].sort((a, b) => {
    const aOpen = a && a.status !== "paid" ? 0 : 1;
    const bOpen = b && b.status !== "paid" ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    const aDue = a && a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const bDue = b && b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return aDue - bDue;
  });
  return { rows: ranked.slice(0, MAX_DEBT_ROWS), total: rows.length };
}

async function answerReceivablesQuery(question, debtsSummary) {
  const anthropic = getClient();
  if (!anthropic) return null;

  const { rows, total } = trimDebtsForPrompt(debtsSummary);
  const subsetNote =
    rows.length < total
      ? `The list below is a SUBSET: ${rows.length} of ${total} invoices, open ones first ` +
        `and soonest due first. Do not state totals or counts across the whole book, and ` +
        `say plainly that you are working from the most urgent ${rows.length}.`
      : null;

  const prompt = [
    `You are a receivables assistant. Answer the question using ONLY the data below.`,
    `Be concise and specific (name amounts and debtors). Return plain text.`,
    subsetNote,
    ``,
    `Question: ${question}`,
    ``,
    `Debts (JSON): ${JSON.stringify(rows)}`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });
    return extractText(response);
  } catch (err) {
    console.error("answerReceivablesQuery AI error:", err.message);
    return null;
  }
}

async function explainAlert({
  symbol,
  conditionType,
  conditionValue,
  baseline,
  price,
  pctChange,
  suggestion,
}) {
  const anthropic = getClient();
  if (!anthropic) return null;

  const prompt = [
    `Explain a crypto price alert in ONE or TWO plain-language sentences for a trader.`,
    `Coin: ${symbol}. Condition: ${conditionType} ${conditionValue}.`,
    baseline != null ? `Baseline price: ${baseline}.` : "",
    `Current price: ${price}.`,
    pctChange != null ? `Change vs baseline: ${pctChange.toFixed(2)}%.` : "",
    `Suggested action: ${suggestion}.`,
    `State the WHY, then the suggestion. Return ONLY the explanation text.`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });
    return extractText(response);
  } catch (err) {
    console.error("explainAlert AI error:", err.message);
    return null;
  }
}

async function explainProfit({ mode, symbol, qty, avgCost, price, profitUsd, profitPct, totalProfitUsd, cashSymbol, partial }) {
  const anthropic = getClient();
  if (!anthropic) return null;

  const prompt = [
    `You are LedgerWatch's profit agent. Write ONE or TWO plain sentences telling a trader about a profit they just realised.`,
    `Mode: ${mode === "live" ? "live trade with real money" : "paper trade with simulated money"}.`,
    `Sold ${qty} ${symbol} at ${price} USD each, bought at an average of ${avgCost} USD each.`,
    `Profit: ${profitUsd.toFixed(2)} USD (${profitPct.toFixed(2)}%).`,
    partial ? "Only part of what was sold had a recorded purchase price; the profit covers that part." : "",
    totalProfitUsd != null ? `Total profit recorded so far in this mode: ${totalProfitUsd.toFixed(2)} USD.` : "",
    mode === "live"
      ? `The profit, ${profitUsd.toFixed(2)} ${cashSymbol}, is ready to move to their profit wallet once they confirm it.`
      : "The profit has been moved from trading cash to their paper profit balance.",
    "Use plain words. No advice to buy or sell. No emojis. No dashes. Return ONLY the text.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 160,
      messages: [{ role: "user", content: prompt }],
    });
    return extractText(response);
  } catch (err) {
    console.error("explainProfit AI error:", err.message);
    return null;
  }
}

async function marketChat(message, context) {
  const anthropic = getClient();
  if (!anthropic) return null;

  const system = [
    `You are LedgerWatch's market agent. You help a user manage crypto WATCHES and a`,
    `SIMULATED (paper) portfolio. You NEVER execute real trades or move real money —`,
    `you only create watches and explain things; a human approves alerts.`,
    ``,
    `Reply with ONLY a JSON object (no markdown, no prose outside it):`,
    `{ "watches": [ { "symbol": "BTC", "type": "drop_pct", "value": 5 } ], "reply": "..." }`,
    `- "watches": watches to CREATE from the user's message (may be empty).`,
    `  type is one of: drop_pct | rise_pct | price_below | price_above. If the user`,
    `  names a coin with no explicit condition, use drop_pct with value 5.`,
    `  Only use these supported symbols: ${(context.supportedSymbols || []).join(", ")}.`,
    `- "reply": a short, plain-language message to show the user. If they asked a`,
    `  question (e.g. "how is my portfolio?"), answer it using the context below.`,
  ].join("\n");

  const userContent = [
    `User message: ${message}`,
    ``,
    `Context (JSON): ${JSON.stringify({
      watches: context.watches,
      portfolio: context.portfolio,
      prices: context.prices,
    })}`,
  ].join("\n");

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 700,
      system,
      messages: [{ role: "user", content: userContent }],
    });
    const text = extractText(response);
    if (!text) return null;
    return safeParseChatJson(text);
  } catch (err) {
    console.error("marketChat AI error:", err.message);
    return null;
  }
}

function safeParseChatJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

module.exports = {
  draftReminder,
  answerReceivablesQuery,
  explainAlert,
  explainProfit,
  marketChat,
  MODEL,
};
