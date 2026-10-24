const Watch = require("../models/Watch");
const Alert = require("../models/Alert");
const Portfolio = require("../models/Portfolio");
const SimTrade = require("../models/SimTrade");
const User = require("../models/User");
const { resolveSymbol } = require("./coinMap");
const { getPrices, getPrice } = require("./coingecko.service");
const { explainAlert } = require("./anthropic.service");
const { notifyUser, signActionToken } = require("./push.service");

const STARTING_CASH = 1000000;
const TRADE_FRACTION = 0.1;
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

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

const VALID_TYPES = ["drop_pct", "rise_pct", "price_below", "price_above"];

async function createWatch(userId, { symbol, type, value, coinId }, mode = "paper") {
  let resolvedCoinId;
  let resolvedSymbol;

  if (coinId) {
    resolvedCoinId = String(coinId).trim().toLowerCase();
    if (!/^[a-z0-9-]{1,64}$/.test(resolvedCoinId)) {
      throw httpError(400, "That is not a valid coin id.");
    }
    resolvedSymbol = String(symbol || resolvedCoinId).trim().toUpperCase().slice(0, 16);
    if (!resolvedSymbol) throw httpError(400, "A symbol is required.");
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

  const price = await getPrice(resolvedCoinId);
  const baselinePrice = price && typeof price.usd === "number" ? price.usd : null;

  const watch = await Watch.create({
    userId,
    mode: mode === "live" ? "live" : "paper",
    coinId: resolvedCoinId,
    symbol: resolvedSymbol,
    condition: { type, value: numValue },
    baselinePrice,
    active: true,
  });

  return watch;
}

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

  const isPct = nextType === "drop_pct" || nextType === "rise_pct";
  if (isPct && (watch.baselinePrice == null || typeChanged)) {
    const price = await getPrice(watch.coinId);
    if (price && typeof price.usd === "number") watch.baselinePrice = price.usd;
  }

  watch.lastTriggeredAt = null;
  await watch.save();
  return watch;
}

function evaluateCondition(watch, price) {
  const { type, value } = watch.condition;
  const baseline = watch.baselinePrice;

  switch (type) {
    case "drop_pct": {
      if (baseline == null || baseline <= 0) return { hit: false, pctChange: null };
      const pct = ((baseline - price) / baseline) * 100;
      return { hit: pct >= value, pctChange: pct };
    }
    case "rise_pct": {
      if (baseline == null || baseline <= 0) return { hit: false, pctChange: null };
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

      const isPct =
        watch.condition.type === "drop_pct" || watch.condition.type === "rise_pct";
      if (isPct && watch.baselinePrice == null) {
        watch.baselinePrice = price;
        await watch.save();
        console.log(
          `[market] watch ${watch._id} (${watch.symbol}) had no baseline and has taken ` +
            `${price} as its starting point. It was inert until now.`
        );
        continue;
      }

      const { hit, pctChange } = evaluateCondition(watch, price);
      if (!hit) continue;

      if (
        watch.lastTriggeredAt &&
        now - new Date(watch.lastTriggeredAt).getTime() < ALERT_COOLDOWN_MS
      ) {
        continue;
      }

      const alreadyWaiting = await Alert.exists({
        mode: watch.mode || "paper",
        watchId: watch._id,
        status: "pending",
      });
      if (alreadyWaiting) continue;

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
        mode: watch.mode || "paper",
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

      try {
        await notifyUser(
          watch.userId,
          {
            title: `${watch.symbol.toUpperCase()} alert — agent suggests ${suggestion}`,
            body: message.slice(0, 140),
            tag: `alert-${alert._id}`,
            type: "alert",
            url: `/app/market?alert=${alert._id}`,
            actions: [
              { action: "buy", title: "Buy" },
              { action: "sell", title: "Sell" },
              { action: "dismiss", title: "Dismiss" },
            ],
            tokens: { dismiss: signActionToken(watch.userId, "dismiss_alert", alert._id) },
            alertId: String(alert._id),
          },
          "marketAlerts"
        );
      } catch (err) {
        console.error(`Push for alert ${alert._id} failed:`, err.message);
      }

    } catch (err) {
      console.error(
        `Automation: failed to evaluate watch ${watch._id}:`,
        err.message
      );
    }
  }

  return { alertsCreated, watchesChecked };
}

function assertPaperAlert(alert) {
  if (alert && alert.mode === "live") {
    throw httpError(
      409,
      "This is a live alert. A live trade is a real swap from your own wallet: open the trade " +
        "dialog to execute it, and it is recorded against this alert when it confirms."
    );
  }
}

async function loadOrCreatePortfolio(userId, mode = "paper") {
  const book = mode === "live" ? "live" : "paper";
  let portfolio = await Portfolio.findOne({ userId, mode: book });
  if (!portfolio) {
    portfolio = await Portfolio.create({
      userId,
      mode: book,
      ...(book === "live" ? { cashBalance: 0 } : {}),
    });
  }
  return portfolio;
}

async function getPortfolio(userId, mode = "paper") {
  const portfolio = await loadOrCreatePortfolio(userId, mode);
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

  const startingCash = portfolio.mode === "live" ? 0 : STARTING_CASH;
  const totalPnl = totalValue - startingCash;

  return {
    mode: portfolio.mode === "live" ? "live" : "paper",
    cashBalance,
    holdings: enriched,
    holdingsValue,
    totalValue,
    totalPnl,
    startingCash,
  };
}

async function actOnAlert(userId, alert, intent) {
  if (alert.status !== "pending") {
    throw httpError(409, `Alert is already ${alert.status}`);
  }
  assertPaperAlert(alert);

  const side = intent.action;
  if (side !== "buy" && side !== "sell") {
    throw httpError(400, 'action must be "buy" or "sell"');
  }

  const rawAmount = Number(intent.amount);
  if (!isFinite(rawAmount) || rawAmount <= 0) {
    throw httpError(400, "Enter an amount greater than zero");
  }

  const portfolio = await loadOrCreatePortfolio(userId, alert.mode || "paper");

  const row = await getPrice(alert.coinId);
  const price =
    (row && row.usd) || Number(alert.priceAtAlert) || 0;
  if (!price || price <= 0) {
    throw httpError(400, `No price available for ${alert.symbol} right now`);
  }

  const denom = intent.denom === "quote" ? "quote" : "token";
  const qty = denom === "quote" ? rawAmount / price : rawAmount;
  const value = denom === "quote" ? rawAmount : rawAmount * price;

  let trade = null;

  if (side === "buy") {
    if (value > portfolio.cashBalance + 1e-9) {
      throw httpError(
        400,
        `Amount exceeds your available cash (${portfolio.cashBalance.toFixed(2)})`
      );
    }

    portfolio.cashBalance -= value;
    const existing = portfolio.holdings.find((h) => h.coinId === alert.coinId);
    if (existing) {
      const newQty = existing.qty + qty;
      existing.avgBuyPrice = (existing.qty * existing.avgBuyPrice + qty * price) / newQty;
      existing.qty = newQty;
    } else {
      portfolio.holdings.push({
        coinId: alert.coinId,
        symbol: alert.symbol,
        qty,
        avgBuyPrice: price,
      });
    }
  } else {
    const idx = portfolio.holdings.findIndex((h) => h.coinId === alert.coinId);
    if (idx === -1) throw httpError(400, `You hold no ${alert.symbol} to sell`);

    const holding = portfolio.holdings[idx];
    if (qty > holding.qty + 1e-12) {
      throw httpError(
        400,
        `You only hold ${holding.qty} ${alert.symbol}; cannot sell ${qty}`
      );
    }

    portfolio.cashBalance += qty * price;
    holding.qty -= qty;
    if (holding.qty <= 1e-12) portfolio.holdings.splice(idx, 1);
  }

  trade = await SimTrade.create({
      mode: alert.mode || "paper",
    userId,
    coinId: alert.coinId,
    symbol: alert.symbol,
    side,
    qty,
    priceAtTrade: price,
    approvedByUser: true,
  });

  await portfolio.save();

  alert.status = "approved";
  alert.userAction = side;
  alert.executedQty = qty;
  alert.executedValue = value;
  alert.executedPrice = price;
  alert.actedAt = new Date();
  await alert.save();

  const enrichedPortfolio = await getPortfolio(userId, alert.mode || "paper");
  return { alert, trade, portfolio: enrichedPortfolio };
}

async function approveAlert(userId, alert) {
  if (alert.status !== "pending") {
    throw httpError(409, `Alert is already ${alert.status}`);
  }
  assertPaperAlert(alert);

  const side = alert.suggestion;
  const portfolio = await loadOrCreatePortfolio(userId, alert.mode || "paper");
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

    const spend = portfolio.cashBalance * TRADE_FRACTION;
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
      mode: alert.mode || "paper",
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

    const qty = holding.qty;
    const proceeds = qty * currentPrice;
    portfolio.cashBalance += proceeds;
    portfolio.holdings.splice(idx, 1);

    trade = await SimTrade.create({
      mode: alert.mode || "paper",
      userId,
      coinId: alert.coinId,
      symbol: alert.symbol,
      side: "sell",
      qty,
      priceAtTrade: currentPrice,
      approvedByUser: true,
    });
  }

  await portfolio.save();

  alert.status = "approved";
  await alert.save();

  const enrichedPortfolio = await getPortfolio(userId, alert.mode || "paper");
  return { alert, trade, portfolio: enrichedPortfolio };
}

function parseWatchCommand(message) {
  if (!message || !/watch/i.test(message)) return [];

  const lower = message.toLowerCase();

  let type = null;
  let value = null;
  const condMatch = lower.match(/\b(drop|down|fall|rise|up|gain)\b[^\d]*(\d+(?:\.\d+)?)\s*%?/);
  if (condMatch) {
    const word = condMatch[1];
    type = ["drop", "down", "fall"].includes(word) ? "drop_pct" : "rise_pct";
    value = Number(condMatch[2]);
  }

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

async function buildPortfolioSummaryText(userId, mode) {
  let book = mode === "live" || mode === "paper" ? mode : null;
  if (!book) {
    const user = await User.findById(userId).select("tradingMode").lean();
    book = user && user.tradingMode === "live" ? "live" : "paper";
  }
  const portfolio = await getPortfolio(userId, book);
  const lines = [];
  lines.push(book === "live" ? "Live book." : "Practice book.");
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
  actOnAlert,
  parseWatchCommand,
  buildPortfolioSummaryText,
};
