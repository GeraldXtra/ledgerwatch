const Anthropic = require("@anthropic-ai/sdk");
const { formatDate } = require("../utils/reminderTemplate");

// Model per PROJECT_KICKOFF section 5.
const MODEL = "claude-sonnet-4-6";

let client = null;

/**
 * Lazily create the Anthropic client. Returns null if no API key is configured,
 * so all AI features degrade gracefully (Module 1 must work with NO AI).
 */
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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

/**
 * Draft a nicer reminder message. Returns the AI text, or null if AI is
 * unavailable or the call fails (caller falls back to the plain template).
 */
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

/**
 * Answer a natural-language question over a compact summary of the user's debts.
 * Returns AI text, or null if AI is unavailable / fails (caller computes a fallback).
 */
async function answerReceivablesQuery(question, debtsSummary) {
  const anthropic = getClient();
  if (!anthropic) return null;

  const prompt = [
    `You are a receivables assistant. Answer the question using ONLY the data below.`,
    `Be concise and specific (name amounts and debtors). Return plain text.`,
    ``,
    `Question: ${question}`,
    ``,
    `Debts (JSON): ${JSON.stringify(debtsSummary)}`,
  ].join("\n");

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

/**
 * Word a market alert explanation. Returns text or null (caller uses a template).
 */
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

/**
 * Market agent chat. Parses watch commands into a structured intent AND answers
 * questions using the provided context. Returns a parsed object
 * `{ watches: [{ symbol, type, value }], reply }` or null on failure/no key
 * (caller falls back to the basic parser + computed summary).
 *
 * @param {string} message
 * @param {object} context  { watches, portfolio, prices, supportedSymbols }
 */
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

// Tolerant JSON extraction from the model's reply.
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
  marketChat,
  MODEL,
};
