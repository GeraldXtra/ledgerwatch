const Watch = require("../models/Watch");
const Alert = require("../models/Alert");
const Portfolio = require("../models/Portfolio");
const SimTrade = require("../models/SimTrade");
const { resolveSymbol } = require("./coinMap");
const { getPrices, getPrice } = require("./coingecko.service");
const { explainAlert } = require("./anthropic.service");
const { notifyUser, signActionToken } = require("./push.service");

// Section 2a constants.
const STARTING_CASH = 1000000;
const TRADE_FRACTION = 0.1;
// Crypto analog of the reminder cadence guard — don't re-alert a watch this soon.
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 min

// small error helper so controllers can map to status codes
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function fmt(n) {
  const num = Number(n);
  if (!isFinite(num)) return String(n);
  return num.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

// ---- watches ---------------------------------------------------------------

const VALID_TYPES = ["drop_pct", "rise_pct", "price_below", "price_above"];

/**
 * Create a watch for a user. Accepts either a known symbol (resolved via coinMap)
 * OR an explicit { coinId, symbol } pair from the coin search — so ANY coin can be
 * watched. Captures the current price as baseline. Throws 400 on invalid input.
 */
async function createWatch(userId, { symbol, type, value, coinId }) {
  let resolvedCoinId;
  let resolvedSymbol;

  if (coinId) {
    // From the search picker: trust the CoinGecko id, derive a display symbol.
    resolvedCoinId = String(coinId).trim().toLowerCase();
    resolvedSymbol = (symbol || resolvedCoinId).toString().trim().toUpperCase();
  } else {
    const resolved = resolveSymbol(symbol);
    if (!resolved) {
      throw httpError(
        400,
        `Unsupported coin symbol "${symbol}". Search for a coin or try BTC, ETH, SOL, and others.`
      );
    }
    resolvedCoinId = resolved.coinId;
    resolvedSymbol = resolved.symbol;
  }

  if (!VALID_TYPES.includes(type)) {
    throw httpError(400, `Invalid condition type "${type}"`);
  }
  const numValue = Number(value);
  if (isNaN(numValue) || numValue <= 0) {
    throw httpError(400, "Condition value must be a number greater than 0");
  }

  // Baseline = current price (USD). If CoinGecko is unavailable, baseline stays null.
  const price = await getPrice(resolvedCoinId);
  const baselinePrice = price && typeof price.usd === "number" ? price.usd : null;

  const watch = await Watch.create({
    userId,
    coinId: resolvedCoinId,
    symbol: resolvedSymbol,
    condition: { type, value: numValue },
    baselinePrice,
    active: true,
  });

  return watch;
}

/**
 * Edit a watch's condition (threshold) without deleting and recreating it.
 * Re-captures baseline when switching to a percentage type that has none, and
 * resets lastTriggeredAt so the new condition can fire. Throws 400/404.
 */
async function updateWatchCondition(userId, watchId, { type, value }) {
  const watch = await Watch.findOne({ _id: watchId, userId });
  if (!watch) throw httpError(404, "Watch not found");

  const nextType = type || watch.condition.type;
  if (!VALID_TYPES.includes(nextType)) {
    throw httpError(400, `Invalid condition type "${nextType}"`);
  }
  const numValue = value === undefined ? watch.condition.value : Number(value);
  if (isNaN(numValue) || numValue <= 0) {
    throw httpError(400, "Condition value must be a number greater than 0");
  }

  const prevType = watch.condition.type;
  const typeChanged = nextType !== prevType;
  watch.condition = { type: nextType, value: numValue };

  // For pct conditions, measure from "now" when the type is (re)set to a pct type —
  // recapture the baseline if it's missing OR the type actually changed. Otherwise a
  // stale creation-time baseline would fire a spurious immediate alert on the next pass.
  const isPct = nextType === "drop_pct" || nextType === "rise_pct";
  if (isPct && (watch.baselinePrice == null || typeChanged)) {
    const price = await getPrice(watch.coinId);
    if (price && typeof price.usd === "number") watch.baselinePrice = price.usd;
  }

  watch.lastTriggeredAt = null; // allow the edited condition to fire
  await watch.save();
  return watch;
}

// ---- condition evaluation + alerts ----------------------------------------

/**
 * Evaluate a watch's condition against a current price.
 * @returns {{ hit: boolean, pctChange: number|null }}
 */
function evaluateCondition(watch, price) {
  const { type, value } = watch.condition;
  const baseline = watch.baselinePrice;

  switch (type) {
    case "drop_pct": {
      if (!baseline) return { hit: false, pctChange: null };
      const pct = ((baseline - price) / baseline) * 100;
      return { hit: pct >= value, pctChange: pct };
    }
    case "rise_pct": {
      if (!baseline) return { hit: false, pctChange: null };
      const pct = ((price - baseline) / baseline) * 100;
      return { hit: pct >= value, pctChange: pct };
    }
    case "price_below":
      return { hit: price <= value, pctChange: null };
    case "price_above":
      return { hit: price >= value, pctChange: null };
    default:
      return { hit: false, pctChange: null };
  }
}

function suggestionForType(type) {
  // buy the dip, sell the rally
  if (type === "drop_pct" || type === "price_below") return "buy";
  if (type === "rise_pct" || type === "price_above") return "sell";
  return "hold";
}

function buildAlertMessage(watch, price, pctChange) {
  const { type, value } = watch.condition;
  const sym = watch.symbol;
  switch (type) {
    case "drop_pct":
      return `${sym} dropped ${fmt(pctChange)}% from your baseline ($${fmt(
        watch.baselinePrice
      )} -> $${fmt(price)}). Suggested: buy.`;
    case "rise_pct":
      return `${sym} rose ${fmt(pctChange)}% from your baseline ($${fmt(
        watch.baselinePrice
      )} -> $${fmt(price)}). Suggested: sell.`;
    case "price_below":
      return `${sym} is at $${fmt(price)}, at or below your $${fmt(
        value
      )} threshold. Suggested: buy.`;
    case "price_above":
      return `${sym} is at $${fmt(price)}, at or above your $${fmt(
        value
      )} threshold. Suggested: sell.`;
    default:
      return `${sym} alert at $${fmt(price)}.`;
  }
}

/**
 * PRICE PASS core (section 4). Evaluates active watches against cached prices
 * and creates Alerts for conditions that hit (respecting the cooldown guard).
 * Never throws for a single watch — each is wrapped in try/catch by the caller
 * expectation, but we also guard here. Returns { alertsCreated, watchesChecked }.
 *
 * @param {{ userId?: string }} [opts]
 */
async function runPricePass({ userId } = {}) {
  const query = { active: true };
  if (userId) query.userId = userId;

  const watches = await Watch.find(query);
  const watchesChecked = watches.length;
  if (watchesChecked === 0) return { alertsCreated: 0, watchesChecked: 0 };

  const coinIds = [...new Set(watches.map((w) => w.coinId))];
  const prices = await getPrices(coinIds);

  const now = Date.now();
  let alertsCreated = 0;

  for (const watch of watches) {
    try {
      const priceRow = prices[watch.coinId];
      if (!priceRow || typeof priceRow.usd !== "number") continue;
      const price = priceRow.usd;

      const { hit, pctChange } = evaluateCondition(watch, price);
      if (!hit) continue;

      // cooldown guard — avoids duplicate alerts on rapid re-runs
      if (
        watch.lastTriggeredAt &&
        now - new Date(watch.lastTriggeredAt).getTime() < ALERT_COOLDOWN_MS
      ) {
        continue;
      }

      const suggestion = suggestionForType(watch.condition.type);
      const template = buildAlertMessage(watch, price, pctChange);
      const aiMessage = await explainAlert({
        symbol: watch.symbol,
        conditionType: watch.condition.type,
        conditionValue: watch.condition.value,
        baseline: watch.baselinePrice,
        price,
        pctChange,
        suggestion,
      });
      const message = aiMessage || template;

      const alert = await Alert.create({
        userId: watch.userId,
        watchId: watch._id,
        coinId: watch.coinId,
        symbol: watch.symbol,
        message,
        suggestion,
        priceAtAlert: price,
        status: "pending",
      });

      watch.lastTriggeredAt = new Date();
      await watch.save();
      alertsCreated++;

      // Actionable push: Approve / Dismiss, each carrying a short-lived action token.
      // Human-in-the-loop preserved — the agent never auto-trades. No-ops if push off.
      try {
        await notifyUser(watch.userId, {
          title: `Price alert — ${watch.symbol.toUpperCase()}`,
          body: message.slice(0, 140),
          tag: `alert-${alert._id}`,
          type: "alert",
          url: "/app",
          actions: [
            { action: "approve", title: "Approve" },
            { action: "dismiss", title: "Dismiss" },
          ],
          tokens: {
            approve: signActionToken(watch.userId, "approve", alert._id),
            dismiss: signActionToken(watch.userId, "dismiss", alert._id),
          },
        });
      } catch (err) {
        console.error(`Automation: alert push failed for alert ${alert._id}:`, err.message);
      }
    } catch (err) {
      console.error(
        `Automation: failed to evaluate watch ${watch._id}:`,
        err.message
      );
      // continue to the next watch
    }
  }

  return { alertsCreated, watchesChecked };
}

// ---- portfolio -------------------------------------------------------------

async function loadOrCreatePortfolio(userId) {
  let portfolio = await Portfolio.findOne({ userId });
  if (!portfolio) {
    portfolio = await Portfolio.create({ userId });
  }
  return portfolio;
}

/**
 * Compute the user's sim portfolio with live (cached) values and total P/L.
 */
async function getPortfolio(userId) {
  const portfolio = await loadOrCreatePortfolio(userId);
  const holdings = portfolio.holdings || [];

  const coinIds = [...new Set(holdings.map((h) => h.coinId))];
  const prices = coinIds.length ? await getPrices(coinIds) : {};

  let holdingsValue = 0;
  const enriched = holdings.map((h) => {
    const priceRow = prices[h.coinId];
    const price = priceRow && typeof priceRow.usd === "number" ? priceRow.usd : null;
    const value = price != null ? h.qty * price : null;
    if (value != null) holdingsValue += value;
    return {
      coinId: h.coinId,
      symbol: h.symbol,
      qty: h.qty,
      avgBuyPrice: h.avgBuyPrice,
      price,
      value,
    };
  });

  const cashBalance = portfolio.cashBalance;
  const totalValue = cashBalance + holdingsValue;
  const totalPnl = totalValue - STARTING_CASH;

  return {
    cashBalance,
    holdings: enriched,
    holdingsValue,
    totalValue,
    totalPnl,
    startingCash: STARTING_CASH,
  };
}

/**
 * Approve an alert -> create a SimTrade and update the Portfolio per section 2a.
 * Throws with a status code on invalid states. Returns { alert, trade, portfolio }.
 */
async function approveAlert(userId, alert) {
  if (alert.status !== "pending") {
    throw httpError(409, `Alert is already ${alert.status}`);
  }

  const side = alert.suggestion; // "buy" | "sell" | "hold"
  const portfolio = await loadOrCreatePortfolio(userId);
  let trade = null;

  if (side === "buy") {
    if (portfolio.cashBalance <= 0) {
      throw httpError(400, "Insufficient cash for a buy");
    }
    let price = Number(alert.priceAtAlert);
    if (!price || price <= 0) {
      const row = await getPrice(alert.coinId);
      price = row ? row.usd : 0;
    }
    if (!price || price <= 0) throw httpError(400, "No price available for buy");

    const spend = portfolio.cashBalance * TRADE_FRACTION; // never exceeds cash
    const qty = spend / price;

    portfolio.cashBalance -= spend;

    const existing = portfolio.holdings.find((h) => h.coinId === alert.coinId);
    if (existing) {
      const newQty = existing.qty + qty;
      existing.avgBuyPrice =
        (existing.qty * existing.avgBuyPrice + qty * price) / newQty;
      existing.qty = newQty;
    } else {
      portfolio.holdings.push({
        coinId: alert.coinId,
        symbol: alert.symbol,
        qty,
        avgBuyPrice: price,
      });
    }

    trade = await SimTrade.create({
      userId,
      coinId: alert.coinId,
      symbol: alert.symbol,
      side: "buy",
      qty,
      priceAtTrade: price,
      approvedByUser: true,
    });
  } else if (side === "sell") {
    const idx = portfolio.holdings.findIndex((h) => h.coinId === alert.coinId);
    if (idx === -1) {
      throw httpError(400, `You hold no ${alert.symbol} to sell`);
    }
    const holding = portfolio.holdings[idx];

    const row = await getPrice(alert.coinId);
    const currentPrice =
      (row && row.usd) || Number(alert.priceAtAlert) || holding.avgBuyPrice;

    const qty = holding.qty; // full holding
    const proceeds = qty * currentPrice;
    portfolio.cashBalance += proceeds;
    portfolio.holdings.splice(idx, 1);

    trade = await SimTrade.create({
      userId,
      coinId: alert.coinId,
      symbol: alert.symbol,
      side: "sell",
      qty,
      priceAtTrade: currentPrice,
      approvedByUser: true,
    });
  }
  // side === "hold" -> no trade, just approve

  await portfolio.save();

  alert.status = "approved";
  await alert.save();

  const enrichedPortfolio = await getPortfolio(userId);
  return { alert, trade, portfolio: enrichedPortfolio };
}

// ---- no-AI fallback helpers -----------------------------------------------

/**
 * Parse simple "watch <SYMBOL> [drop|rise] <n>%" commands (and comma lists like
 * "watch ETH, SOL"). Returns an array of { symbol, type, value }. Empty array if
 * the message is not a watch command (treated as a question).
 */
function parseWatchCommand(message) {
  if (!message || !/watch/i.test(message)) return [];

  const lower = message.toLowerCase();

  // Detect a condition: "drop 5%" / "rise 2 %" / "down 3%"
  let type = null;
  let value = null;
  const condMatch = lower.match(/\b(drop|down|fall|rise|up|gain)\b[^\d]*(\d+(?:\.\d+)?)\s*%?/);
  if (condMatch) {
    const word = condMatch[1];
    type = ["drop", "down", "fall"].includes(word) ? "drop_pct" : "rise_pct";
    value = Number(condMatch[2]);
  }

  // Extract candidate symbols (uppercase tokens or known symbols).
  const tokens = message
    .replace(/[,/]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const results = [];
  const seen = new Set();
  for (const tok of tokens) {
    const resolved = resolveSymbol(tok);
    if (!resolved) continue;
    if (seen.has(resolved.symbol)) continue;
    seen.add(resolved.symbol);
    results.push({
      symbol: resolved.symbol,
      type: type || "drop_pct",
      value: value || 5,
    });
  }
  return results;
}

/**
 * Build a plain-text portfolio/status summary for the no-AI fallback.
 */
async function buildPortfolioSummaryText(userId) {
  const portfolio = await getPortfolio(userId);
  const lines = [];
  lines.push(`Cash: $${fmt(portfolio.cashBalance)}.`);
  if (portfolio.holdings.length === 0) {
    lines.push("You hold no coins yet.");
  } else {
    for (const h of portfolio.holdings) {
      const val = h.value != null ? `$${fmt(h.value)}` : "price unavailable";
      lines.push(`${h.symbol}: ${fmt(h.qty)} @ avg $${fmt(h.avgBuyPrice)} -> ${val}.`);
    }
  }
  const sign = portfolio.totalPnl >= 0 ? "+" : "-";
  lines.push(
    `Total value: $${fmt(portfolio.totalValue)} (P/L ${sign}$${fmt(
      Math.abs(portfolio.totalPnl)
    )}).`
  );
  return lines.join(" ");
}

module.exports = {
  STARTING_CASH,
  TRADE_FRACTION,
  ALERT_COOLDOWN_MS,
  createWatch,
  updateWatchCondition,
  evaluateCondition,
  suggestionForType,
  runPricePass,
  getPortfolio,
  approveAlert,
  parseWatchCommand,
  buildPortfolioSummaryText,
};
