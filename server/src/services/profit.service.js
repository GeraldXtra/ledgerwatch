const ProfitRecord = require("../models/ProfitRecord");
const WalletTx = require("../models/WalletTx");
const User = require("../models/User");
const { getChain } = require("../config/chains");
const rpcService = require("./rpc.service");
const { notifyActivity } = require("./activity.service");
const { explainProfit } = require("./anthropic.service");

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const CASH_RE = /^(USDC|USDT|USD₮0|USDT0|USDt)$/i;
const MIN_PROFIT_USD = 0.01;
const DUST = 1e-12;

function usd(n) {
  return `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function units(n, max = 8) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: max });
}

function lower(a) {
  return a ? String(a).toLowerCase() : null;
}

function floorTo(amount, decimals) {
  const p = Math.max(0, Math.min(12, Number(decimals) || 0));
  const [whole, frac = ""] = Number(amount).toFixed(p + 3).split(".");
  const cut = frac.slice(0, p).replace(/0+$/, "");
  return cut ? `${whole}.${cut}` : whole;
}

function realised({ qty, avgCost, price }) {
  const costUsd = qty * avgCost;
  const proceedsUsd = qty * price;
  const profitUsd = proceedsUsd - costUsd;
  const profitPct = costUsd > 0 ? (profitUsd / costUsd) * 100 : 0;
  return { costUsd, proceedsUsd, profitUsd, profitPct };
}

function templateMessage({ mode, symbol, qty, avgCost, price, profitUsd, profitPct, cashSymbol }) {
  const head =
    `You sold ${units(qty)} ${symbol} at ${usd(price)} after buying at an average of ${usd(avgCost)}, ` +
    `a profit of ${usd(profitUsd)} (${profitPct.toFixed(2)}%).`;
  return mode === "live"
    ? `${head} It is ready to move to your profit wallet as ${units(profitUsd, 6)} ${cashSymbol} once you confirm it.`
    : `${head} It has been moved from your trading cash to your paper profit balance.`;
}

async function totalProfit(userId, mode) {
  const rows = await ProfitRecord.aggregate([
    { $match: { userId, mode, status: { $in: ["moved", "pending", "moving", "dismissed"] } } },
    { $group: { _id: null, total: { $sum: "$profitUsd" } } },
  ]).catch(() => []);
  return rows.length ? rows[0].total : 0;
}

async function announceProfit(record) {
  const isLive = record.mode === "live";
  const title = isLive
    ? `Profit of ${usd(record.profitUsd)} on ${record.symbol}`
    : `Paper profit of ${usd(record.profitUsd)} on ${record.symbol}`;
  const body = isLive
    ? `Ready to move ${units(record.profitUsd, 6)} ${record.cashSymbol} to your profit wallet. Open it to confirm.`
    : `Moved to your paper profit balance.`;
  return notifyActivity(record.userId, {
    category: "profit",
    tag: `profit-${record._id}`,
    url: "/app/market?view=portfolio",
    coinId: record.coinId || undefined,
    symbol: record.symbol,
    title,
    body,
    email: {
      subject: title,
      intro: record.message,
      tone: "pos",
      hero: {
        label: isLive ? "Profit realised" : "Paper profit realised",
        value: usd(record.profitUsd),
        sub: `${record.profitPct != null ? `${record.profitPct.toFixed(2)}% on ` : ""}${record.symbol}`,
      },
      rows: [
        { label: "Sold", value: `${units(record.coveredQty || record.qty)} ${record.symbol}` },
        { label: "Average purchase price", value: record.avgCost != null ? usd(record.avgCost) : undefined },
        { label: "Sale price", value: record.price != null ? usd(record.price) : undefined },
        { label: "Cost", value: record.costUsd != null ? usd(record.costUsd) : undefined },
        { label: "Proceeds", value: record.proceedsUsd != null ? usd(record.proceedsUsd) : undefined },
        { label: "Status", value: isLive ? "Waiting for you to move it" : "Moved to your paper profit balance" },
        { label: "Note", value: record.note || undefined },
      ],
      cta: {
        label: isLive ? "Move it to my profit wallet" : "See my portfolio",
        url: require("../utils/emailBrand").appUrl("/app/market?view=portfolio"),
      },
    },
  });
}

async function writeMessage(record) {
  const total = await totalProfit(record.userId, record.mode);
  const facts = {
    mode: record.mode,
    symbol: record.symbol,
    qty: record.coveredQty || record.qty,
    avgCost: record.avgCost,
    price: record.price,
    profitUsd: record.profitUsd,
    profitPct: record.profitPct || 0,
    totalProfitUsd: total,
    cashSymbol: record.cashSymbol,
    partial: Boolean(record.coveredQty && record.coveredQty + DUST < record.qty),
  };
  const ai = await explainProfit(facts).catch(() => null);
  return ai || templateMessage(facts);
}

function paperSale({ holding, qty, price }) {
  const avgCost = Number(holding.avgBuyPrice) || 0;
  const r = realised({ qty, avgCost, price });
  return { avgCost, ...r };
}

async function recordPaperSale({ userId, mode = "paper", coinId, symbol, qty, avgCost, price, tradeId, movedUsd }) {
  const r = realised({ qty, avgCost, price });
  const isProfit = movedUsd > 0;
  const record = await ProfitRecord.create({
    userId,
    mode,
    status: isProfit ? "moved" : "loss",
    coinId,
    symbol: String(symbol || "").toUpperCase(),
    qty,
    coveredQty: qty,
    avgCost,
    price,
    costUsd: r.costUsd,
    proceedsUsd: r.proceedsUsd,
    profitUsd: isProfit ? movedUsd : r.profitUsd,
    profitPct: r.profitPct,
    cashSymbol: "USD",
    tradeId,
    movedAt: isProfit ? new Date() : null,
  });
  if (!isProfit) return record;
  record.message = await writeMessage(record);
  await record.save();
  announceProfit(record).catch((err) => console.error("[profit] announce failed:", err.message));
  return record;
}

async function decimalsOf(chain, address) {
  const known = (chain.tokens || []).find((t) => lower(t.address) === lower(address));
  if (known && Number.isInteger(known.decimals)) return known.decimals;
  const read = await rpcService.rpcCallTyped(chain, "eth_call", [{ to: address, data: "0x313ce567" }, "latest"]);
  if (!read.ok || typeof read.result !== "string" || read.result === "0x") return null;
  const d = Number(BigInt(read.result));
  return Number.isInteger(d) && d >= 0 && d <= 36 ? d : null;
}

async function receivedInReceipt({ chain, hash, token, recipient }) {
  if (!token || !recipient) return null;
  const read = await rpcService.rpcCallTyped(chain, "eth_getTransactionReceipt", [hash]);
  if (!read.ok || !read.result || read.result.status !== "0x1") return null;
  const decimals = await decimalsOf(chain, token);
  if (decimals == null) return null;
  const want = "0x" + String(recipient).toLowerCase().replace(/^0x/, "").padStart(64, "0");
  let raw = 0n;
  let seen = false;
  for (const log of read.result.logs || []) {
    if (lower(log.address) !== lower(token)) continue;
    if (!Array.isArray(log.topics) || log.topics[0] !== TRANSFER_TOPIC || lower(log.topics[2]) !== want) continue;
    try {
      raw += BigInt(log.data || "0x0");
      seen = true;
    } catch {
      return null;
    }
  }
  if (!seen) return null;
  return Number(raw) / 10 ** decimals;
}

function assetOf(tx) {
  return tx.side === "sell" ? lower(tx.tokenAddress) : lower(tx.tokenOut);
}

async function costBasisBefore(tx) {
  const asset = assetOf(tx);
  const earlier = await WalletTx.find({
    userId: tx.userId,
    chainId: tx.chainId,
    kind: "swap",
    status: "confirmed",
    _id: { $ne: tx._id },
    createdAt: { $lte: tx.createdAt },
  })
    .sort({ createdAt: 1 })
    .lean();

  let qty = 0;
  let cost = 0;
  let estimated = false;
  for (const row of earlier) {
    if (row.side === "buy" && lower(row.tokenOut) === asset && CASH_RE.test(row.symbol || "")) {
      const got = row.amountOutActual != null ? Number(row.amountOutActual) : Number(row.amountOut);
      const paid = Number(row.value);
      if (!(got > 0) || !(paid >= 0)) continue;
      if (row.amountOutActual == null) estimated = true;
      qty += got;
      cost += paid;
    } else if (row.side === "sell" && lower(row.tokenAddress) === asset && qty > DUST) {
      const sold = Math.min(Number(row.value) || 0, qty);
      const avg = cost / qty;
      cost -= avg * sold;
      qty -= sold;
    }
  }
  return { qty, cost, avgCost: qty > DUST ? cost / qty : null, estimated };
}

async function onLiveSwapConfirmed(txOrId) {
  const tx = txOrId && txOrId._id ? txOrId : await WalletTx.findById(txOrId).lean();
  if (!tx || tx.kind !== "swap" || tx.status !== "confirmed") return null;
  const chain = getChain(tx.chainId);
  if (!chain) return null;

  const outToken = tx.tokenOut;
  const actual = await receivedInReceipt({ chain, hash: tx.hash, token: outToken, recipient: tx.from }).catch(() => null);
  if (actual != null) {
    await WalletTx.updateOne({ _id: tx._id }, { $set: { amountOutActual: String(actual) } }).catch(() => {});
    tx.amountOutActual = String(actual);
  }

  if (tx.side !== "sell") return null;
  const exists = await ProfitRecord.exists({ txId: tx._id });
  if (exists) return null;

  const symbol = String(tx.symbol || "").toUpperCase();
  const soldQty = Number(tx.value);
  const base = {
    userId: tx.userId,
    mode: "live",
    symbol,
    chainId: tx.chainId,
    assetAddress: lower(tx.tokenAddress),
    qty: soldQty,
    txId: tx._id,
    txHash: tx.hash,
    cashSymbol: tx.tokenOutSymbol || "USDC",
    cashAddress: lower(tx.tokenOut),
  };

  if (!CASH_RE.test(tx.tokenOutSymbol || "")) {
    return ProfitRecord.create({
      ...base,
      status: "no-basis",
      note: `This sale was paid in ${tx.tokenOutSymbol || "a token"}, not a dollar stablecoin, so its profit in dollars is not measured.`,
    }).catch(() => null);
  }

  const proceeds = tx.amountOutActual != null ? Number(tx.amountOutActual) : Number(tx.amountOut);
  const basis = await costBasisBefore(tx);
  const covered = Math.min(soldQty, basis.qty);
  if (!(soldQty > 0) || !(proceeds > 0) || covered <= DUST || basis.avgCost == null) {
    return ProfitRecord.create({
      ...base,
      status: "no-basis",
      proceedsUsd: proceeds > 0 ? proceeds : null,
      note: `No purchase of this ${symbol} was recorded in LedgerWatch, so its cost, and therefore the profit, is not known.`,
    }).catch(() => null);
  }

  const price = proceeds / soldQty;
  const r = realised({ qty: covered, avgCost: basis.avgCost, price });
  const estimated = basis.estimated || tx.amountOutActual == null;
  const notes = [];
  if (covered + DUST < soldQty) {
    notes.push(`Only ${units(covered)} of the ${units(soldQty)} ${symbol} sold had a recorded purchase price; the profit covers that part.`);
  }
  if (estimated) notes.push("Some amounts are the quoted figures, because the chain receipt could not be read.");

  const cashDecimals = (await decimalsOf(chain, tx.tokenOut)) ?? 6;
  const isProfit = r.profitUsd >= MIN_PROFIT_USD;
  let record;
  try {
    record = await ProfitRecord.create({
      ...base,
      status: isProfit ? "pending" : "loss",
      coveredQty: covered,
      avgCost: basis.avgCost,
      price,
      costUsd: r.costUsd,
      proceedsUsd: r.proceedsUsd,
      profitUsd: r.profitUsd,
      profitPct: r.profitPct,
      basisEstimated: estimated,
      note: notes.join(" ") || null,
      cashDecimals,
      profitAmount: isProfit ? floorTo(r.profitUsd, cashDecimals) : null,
    });
  } catch (err) {
    if (err.code === 11000) return null;
    throw err;
  }
  if (!isProfit) return record;
  record.message = await writeMessage(record);
  await record.save();
  announceProfit(record).catch((err) => console.error("[profit] announce failed:", err.message));
  return record;
}

async function listProfits(userId, mode) {
  const query = { userId };
  if (mode === "paper" || mode === "live") query.mode = mode;
  const rows = await ProfitRecord.find(query).sort({ createdAt: -1 }).limit(200).lean();
  const totals = { paper: 0, live: 0, pendingLive: 0, movedLive: 0 };
  for (const row of await ProfitRecord.find({ userId, status: { $in: ["moved", "pending", "moving", "dismissed"] } })
    .select("mode status profitUsd")
    .lean()) {
    totals[row.mode] += row.profitUsd || 0;
    if (row.mode === "live" && (row.status === "pending" || row.status === "moving")) totals.pendingLive += row.profitUsd || 0;
    if (row.mode === "live" && row.status === "moved") totals.movedLive += row.profitUsd || 0;
  }
  const user = await User.findById(userId).select("profitAddress").lean();
  return { profits: rows, totals, profitAddress: (user && user.profitAddress) || null };
}

async function dismissProfit(userId, id) {
  const row = await ProfitRecord.findOneAndUpdate(
    { _id: id, userId, mode: "live", status: "pending" },
    { $set: { status: "dismissed", decidedAt: new Date() } },
    { new: true }
  );
  return row;
}

async function markMoving(userId, id, { txId, txHash, profitAddress }) {
  const row = await ProfitRecord.findOneAndUpdate(
    { _id: id, userId, mode: "live", status: { $in: ["pending", "moving"] } },
    { $set: { status: "moving", moveTxId: txId, moveTxHash: txHash, profitAddress: lower(profitAddress), decidedAt: new Date() } },
    { new: true }
  );
  if (row && profitAddress) {
    await User.updateOne({ _id: userId }, { $set: { profitAddress: lower(profitAddress) } }).catch(() => {});
  }
  return row;
}

async function onMoveSettled(tx) {
  if (!tx || !tx.profitId) return null;
  if (tx.status === "confirmed") {
    const row = await ProfitRecord.findOneAndUpdate(
      { _id: tx.profitId, userId: tx.userId, status: { $in: ["pending", "moving"] } },
      { $set: { status: "moved", movedAt: new Date(), moveTxId: tx._id, moveTxHash: tx.hash } },
      { new: true }
    );
    if (row) {
      const chain = getChain(tx.chainId);
      notifyActivity(row.userId, {
        category: "profit",
        tag: `profit-${row._id}`,
        url: "/app/market?view=portfolio",
        symbol: row.cashSymbol,
        title: `${units(Number(tx.value), 6)} ${tx.symbol} moved to your profit wallet`,
        body: `Your profit from ${row.symbol} is in your profit wallet on ${chain ? chain.name : "chain"}.`,
        email: {
          subject: `Your ${usd(row.profitUsd)} profit is in your profit wallet`,
          intro: `The profit from your ${row.symbol} sale has been moved to your profit wallet. It is Account 2 of your recovery phrase, so it also appears in any wallet you import that phrase into.`,
          tone: "pos",
          hero: { label: "Moved to your profit wallet", value: `${units(Number(tx.value), 6)} ${tx.symbol}`, sub: chain ? `on ${chain.name}` : undefined },
          rows: [
            { label: "Profit wallet", value: tx.to, mono: true },
            { label: "From the sale of", value: row.symbol },
            {
              label: "Transaction",
              value: `${tx.hash.slice(0, 10)}…${tx.hash.slice(-6)}`,
              href: chain && chain.explorer ? `${chain.explorer}/tx/${tx.hash}` : undefined,
              mono: true,
            },
          ],
        },
      }).catch(() => {});
    }
    return row;
  }
  if (tx.status === "failed") {
    return ProfitRecord.findOneAndUpdate(
      { _id: tx.profitId, userId: tx.userId, status: "moving" },
      { $set: { status: "pending", moveTxId: null, moveTxHash: null } },
      { new: true }
    );
  }
  return null;
}

module.exports = {
  CASH_RE,
  MIN_PROFIT_USD,
  realised,
  paperSale,
  recordPaperSale,
  onLiveSwapConfirmed,
  costBasisBefore,
  receivedInReceipt,
  listProfits,
  dismissProfit,
  markMoving,
  onMoveSettled,
  templateMessage,
  floorTo,
};
