const WalletTx = require("../models/WalletTx");
const PaymentAddress = require("../models/PaymentAddress");
const { getChain } = require("../config/chains");
const rpcService = require("./rpc.service");
const { notifyActivity } = require("./activity.service");
const User = require("../models/User");

const MIN_AGE_MS = 15 * 1000;
const MAX_AGE_MS = 72 * 60 * 60 * 1000;
const UNSEEN_FAIL_AFTER_MS = 3 * 60 * 60 * 1000;
const PASS_LIMIT = 60;
const PASS_BUDGET_MS = 15 * 1000;

function short(address) {
  const a = String(address || "");
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function amount(value, symbol) {
  const n = Number(value);
  const shown = Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 6 }) : String(value || "");
  return `${shown} ${symbol || ""}`.trim();
}

function explorerFor(chain, hash) {
  return chain && chain.explorer && hash ? `${chain.explorer}/tx/${hash}` : null;
}

async function isSweep(tx) {
  if (tx.direction !== "in" || tx.kind !== "transfer") return false;
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(tx.from || ""))) return false;
  const pa = await PaymentAddress.findOne({ userId: tx.userId, address: new RegExp(`^${tx.from}$`, "i") })
    .select("_id")
    .lean()
    .catch(() => null);
  return Boolean(pa);
}

async function eventForTx(tx) {
  const chain = getChain(tx.chainId);
  const network = chain ? chain.name : `chain ${tx.chainId}`;
  const ok = tx.status === "confirmed";
  const explorer = explorerFor(chain, tx.hash);
  const txRow = { label: "Transaction", value: short(tx.hash), href: explorer || undefined, mono: true };
  const tag = `tx-${tx._id}`;

  if (tx.kind === "swap" && !tx.side) {
    const gave = amount(tx.value, tx.symbol);
    const got = amount(tx.amountOut, tx.tokenOutSymbol);
    if (!ok) {
      return {
        category: "trades",
        tag,
        url: "/app/wallet",
        symbol: tx.symbol,
        title: `Swap failed on ${network}`,
        body: `Your swap of ${gave} for ${tx.tokenOutSymbol || "another asset"} did not go through. Your ${tx.symbol} stayed in your wallet; only the network fee was spent.`,
      };
    }
    return {
      category: "trades",
      tag,
      url: "/app/wallet",
      symbol: tx.tokenOutSymbol,
      title: `Swapped ${gave} for ${got}`,
      body: `On ${network}. The ${tx.tokenOutSymbol} is in your wallet.`,
      email: {
        subject: `You swapped ${gave} for ${got}`,
        intro: `Your swap on ${network} has confirmed, and the ${tx.tokenOutSymbol} is in your wallet.`,
        tone: "pos",
        hero: { label: "You received", value: got, sub: `for ${gave}` },
        rows: [
          { label: "Network", value: network },
          { label: "Route", value: tx.route || undefined },
          { label: "Minimum received", value: tx.minAmountOut ? amount(tx.minAmountOut, tx.tokenOutSymbol) : undefined },
          txRow,
        ],
      },
    };
  }

  if (tx.kind === "swap") {
    const gave = amount(tx.value, tx.symbol);
    const got = amount(tx.amountOut, tx.tokenOutSymbol);
    const bought = tx.side !== "sell";
    if (!ok) {
      return {
        category: "trades",
        tag,
        url: "/app/market?view=portfolio",
        symbol: bought ? tx.tokenOutSymbol : tx.symbol,
        title: `Swap failed on ${network}`,
        body: `Your swap of ${gave} for ${tx.tokenOutSymbol || "a token"} did not go through. Your ${tx.symbol} stayed in your wallet; only the network fee was spent.`,
      };
    }
    return {
      category: "trades",
      tag,
      url: "/app/market?view=portfolio",
      symbol: bought ? tx.tokenOutSymbol : tx.symbol,
      title: bought ? `Bought ${got}` : `Sold ${gave}`,
      body: bought ? `Paid ${gave} on ${network}. It is in your wallet.` : `Received about ${got} on ${network}.`,
      email: {
        subject: bought ? `You bought ${got}` : `You sold ${gave}`,
        intro: bought
          ? `Your live trade on ${network} has confirmed, and the ${tx.tokenOutSymbol} is in your wallet.`
          : `Your live trade on ${network} has confirmed. The ${tx.symbol} has been sold and the ${tx.tokenOutSymbol} is in your wallet.`,
        tone: "pos",
        hero: { label: bought ? "You bought" : "You sold", value: bought ? got : gave, sub: bought ? `for ${gave}` : `for about ${got}` },
        rows: [
          { label: "Network", value: network },
          { label: "Route", value: tx.route || undefined },
          { label: "Minimum received", value: tx.minAmountOut ? amount(tx.minAmountOut, tx.tokenOutSymbol) : undefined },
          txRow,
        ],
      },
    };
  }

  if (tx.kind === "approval") {
    return {
      category: "txUpdates",
      tag,
      url: "/app/market",
      symbol: tx.symbol,
      title: ok ? `${tx.symbol} approved for trading` : `Approval failed on ${network}`,
      body: ok
        ? `The exchange on ${network} can now move exactly the ${tx.symbol} this trade needs.`
        : `The approval for ${tx.symbol} did not go through. Nothing was traded.`,
    };
  }

  if (tx.direction === "in") {
    const sweep = await isSweep(tx);
    const what = amount(tx.value, tx.symbol);
    if (!ok) {
      return {
        category: "txUpdates",
        tag,
        url: "/app/receivables",
        symbol: tx.symbol,
        title: `Sweep failed on ${network}`,
        body: `Moving ${what} from an invoice address did not go through. The money is still at that address.`,
      };
    }
    return {
      category: "moneyIn",
      tag,
      url: sweep ? "/app/receivables" : "/app/wallet",
      symbol: tx.symbol,
      title: sweep ? `Swept ${what} to your wallet` : `Received ${what}`,
      body: sweep
        ? `Moved from an invoice address on ${network}.`
        : `From ${short(tx.from)} on ${network}.`,
      email: {
        subject: sweep ? `${what} swept to your wallet` : `You received ${what}`,
        intro: sweep
          ? `The money an invoice address collected has been moved to your wallet on ${network}.`
          : `Money has arrived in your LedgerWatch wallet on ${network}.`,
        tone: "pos",
        hero: { label: sweep ? "Swept" : "Received", value: what, sub: `on ${network}` },
        rows: [
          { label: "From", value: tx.from, mono: true },
          { label: "To", value: tx.to, mono: true },
          { label: "Network", value: network },
          txRow,
        ],
      },
    };
  }

  const what = amount(tx.value, tx.symbol);
  if (!ok) {
    return {
      category: "txUpdates",
      tag,
      url: "/app/wallet",
      symbol: tx.symbol,
      title: `Transfer failed on ${network}`,
      body: `Sending ${what} to ${short(tx.to)} did not go through. Only the network fee, if any, was spent.`,
    };
  }
  return {
    category: "txUpdates",
    tag,
    url: "/app/wallet",
    symbol: tx.symbol,
    title: `Sent ${what}`,
    body: `To ${short(tx.to)} on ${network}. It has confirmed.`,
    email: {
      subject: `You sent ${what}`,
      intro: `Your transfer on ${network} has confirmed.`,
      tone: "pos",
      hero: { label: "Sent", value: what, sub: `on ${network}` },
      rows: [
        { label: "To", value: tx.to, mono: true },
        { label: "Network", value: network },
        txRow,
      ],
    },
  };
}

async function announceWalletTx(txOrId) {
  const id = txOrId && txOrId._id ? txOrId._id : txOrId;
  const claimed = await WalletTx.findOneAndUpdate(
    { _id: id, notifiedAt: null, status: { $in: ["confirmed", "failed"] } },
    { $set: { notifiedAt: new Date() } },
    { new: true }
  ).lean();
  if (!claimed) return null;
  const profit = require("./profit.service");
  if (claimed.profitId) {
    await profit.onMoveSettled(claimed).catch((err) => console.error("[walletActivity] profit move:", err.message));
    if (claimed.status === "confirmed") return null;
  }
  const event = await eventForTx(claimed);
  const sent = await notifyActivity(claimed.userId, event);
  if (claimed.kind === "swap" && claimed.status === "confirmed") {
    await profit.onLiveSwapConfirmed(claimed).catch((err) => console.error("[walletActivity] profit agent:", err.message));
  }
  return sent;
}

async function settleWalletTx(txId, status) {
  if (!["confirmed", "failed"].includes(status)) return null;
  const updated = await WalletTx.findOneAndUpdate(
    { _id: txId, status: "pending" },
    { $set: { status } },
    { new: true }
  );
  if (!updated) return null;
  announceWalletTx(updated._id).catch((err) => console.error("[walletActivity] announce failed:", err.message));
  return updated;
}

async function runWalletTxPass({ userId, now = Date.now() } = {}) {
  const startedAt = Date.now();
  const query = {
    status: "pending",
    createdAt: { $lte: new Date(now - MIN_AGE_MS), $gte: new Date(now - MAX_AGE_MS) },
  };
  if (userId) query.userId = userId;
  const rows = await WalletTx.find(query).sort({ lastCheckedAt: 1, createdAt: 1 }).limit(PASS_LIMIT);

  let checked = 0;
  let settled = 0;
  for (const tx of rows) {
    if (Date.now() - startedAt > PASS_BUDGET_MS) break;
    const chain = getChain(tx.chainId);
    if (!chain) continue;
    checked += 1;
    await WalletTx.updateOne({ _id: tx._id }, { $set: { lastCheckedAt: new Date() } });

    const read = await rpcService.rpcCallTyped(chain, "eth_getTransactionReceipt", [tx.hash]);
    if (!read.ok) continue;
    if (read.result) {
      const status = read.result.status === "0x1" ? "confirmed" : "failed";
      if (await settleWalletTx(tx._id, status)) settled += 1;
      continue;
    }
    if (now - new Date(tx.createdAt).getTime() < UNSEEN_FAIL_AFTER_MS) continue;
    const seen = await rpcService.rpcCallTyped(chain, "eth_getTransactionByHash", [tx.hash]);
    if (seen.ok && !seen.result) {
      if (await settleWalletTx(tx._id, "failed")) settled += 1;
    }
  }
  return { checked, settled };
}

function positiveMs(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const INBOUND_EVERY_MS = positiveMs(process.env.WALLET_WATCH_INTERVAL_MS, 5 * 60 * 1000);
const INBOUND_BUDGET_MS = 20 * 1000;
const NATIVE_DUST_WEI = 10n ** 12n;
const inboundCheckedAt = new Map();
const nativeSeen = new Map();

function weiToString(wei) {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

async function checkNativeArrival({ userId, chain, address, since }) {
  const key = `${userId}:${chain.chainId}`;
  const read = await rpcService.rpcCallTyped(chain, "eth_getBalance", [address, "latest"]);
  if (!read.ok || typeof read.result !== "string") return 0;
  let now;
  try {
    now = BigInt(read.result);
  } catch {
    return 0;
  }
  const before = nativeSeen.get(key);
  nativeSeen.set(key, now);
  if (before == null || now <= before || now - before < NATIVE_DUST_WEI) return 0;

  const explained = await WalletTx.exists({
    userId,
    chainId: chain.chainId,
    $or: [{ kind: "swap" }, { direction: "in" }],
    createdAt: { $gte: new Date(since - 10 * 60 * 1000) },
  }).catch(() => true);
  if (explained) return 0;

  const what = `${weiToString(now - before)} ${chain.nativeSymbol || "ETH"}`;
  notifyActivity(userId, {
    category: "moneyIn",
    tag: `native-${chain.chainId}-${now.toString().slice(-12)}`,
    url: "/app/wallet",
    symbol: chain.nativeSymbol,
    title: `Received ${what}`,
    body: `Your ${chain.name} balance went up by ${what}.`,
    email: {
      subject: `You received ${what}`,
      intro: `Your ${chain.nativeSymbol || "ETH"} balance on ${chain.name} went up by ${what}. Open your wallet to see it.`,
      tone: "pos",
      hero: { label: "Received", value: what, sub: `on ${chain.name}` },
      rows: [
        { label: "Wallet", value: address, mono: true },
        { label: "Network", value: chain.name },
        { label: "Balance now", value: `${weiToString(now)} ${chain.nativeSymbol || "ETH"}` },
      ],
    },
  }).catch((err) => console.error("[walletActivity] native notice failed:", err.message));
  return 1;
}

async function runInboundPass({ userId, now = Date.now() } = {}) {
  const { getChain, listChains } = require("../config/chains");
  const { syncInboundTransfers } = require("./walletHistory.service");
  const startedAt = Date.now();
  const mainnets = listChains().filter((c) => !c.testnet).map((c) => c.chainId);

  const query = { walletAddress: { $ne: null } };
  if (userId) query._id = userId;
  const users = await User.find(query).select("walletAddress walletHistoryCursors crypto.defaultChainId").lean();

  const jobs = [];
  for (const u of users) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(u.walletAddress || ""))) continue;
    const ids = new Set([...(u.walletHistoryCursors || []).map((c) => c.chainId), ...mainnets]);
    if (u.crypto && u.crypto.defaultChainId) ids.add(Number(u.crypto.defaultChainId));
    for (const chainId of ids) {
      const key = `${u._id}:${chainId}`;
      const last = inboundCheckedAt.get(key) || 0;
      if (now - last < INBOUND_EVERY_MS) continue;
      jobs.push({ key, last, userId: u._id, chainId, address: u.walletAddress });
    }
  }
  jobs.sort((a, b) => a.last - b.last);

  let checked = 0;
  let announced = 0;
  for (const job of jobs) {
    if (Date.now() - startedAt > INBOUND_BUDGET_MS) break;
    const chain = getChain(job.chainId);
    if (!chain) continue;
    inboundCheckedAt.set(job.key, now);
    checked += 1;
    try {
      const sync = await syncInboundTransfers({ userId: job.userId, chainId: job.chainId, address: job.address });
      announced += (sync && sync.announced) || 0;
      announced += await checkNativeArrival({ userId: job.userId, chain, address: job.address, since: job.last || now });
    } catch (err) {
      console.error(`[walletActivity] inbound check failed on ${chain.name}:`, err.message);
    }
  }
  return { checked, announced, deferred: Math.max(0, jobs.length - checked) };
}

const CHAIN_WATCH_EVERY_MS = positiveMs(process.env.CHAIN_WATCH_INTERVAL_MS, 15 * 60 * 1000);
const CHAIN_WATCH_BUDGET_MS = 25 * 1000;

const CHAIN_LABELS = {
  bitcoin: "Bitcoin",
  litecoin: "Litecoin",
  dogecoin: "Dogecoin",
  tron: "TRON",
  solana: "Solana",
  ton: "TON",
};

async function readChainBalances(chain, network, address) {
  if (["bitcoin", "litecoin", "dogecoin"].includes(chain)) {
    const r = await require("./utxo.service").getBalance(address, network, chain);
    if (!r.ok) return null;
    const symbol = { bitcoin: "BTC", litecoin: "LTC", dogecoin: "DOGE" }[chain];
    return [{ symbol, decimals: 8, amount: BigInt(Math.round(Number(r.total) || 0)) }];
  }
  if (chain === "tron") {
    const r = await require("./tron.service").getAccount(address, network);
    if (!r.ok) return null;
    const out = [{ symbol: "TRX", decimals: 6, amount: BigInt(r.balanceSun || 0) }];
    for (const t of r.tokens || []) if (t.balance != null) out.push({ symbol: t.symbol, decimals: t.decimals, amount: BigInt(t.balance) });
    return out;
  }
  if (chain === "solana") {
    const r = await require("./solana.service").getAccount(address, network);
    if (!r.ok) return null;
    const out = [{ symbol: "SOL", decimals: 9, amount: BigInt(r.lamports || 0) }];
    for (const t of r.tokens || []) if (t.amount != null) out.push({ symbol: t.symbol, decimals: t.decimals, amount: BigInt(t.amount) });
    return out;
  }
  if (chain === "ton") {
    const r = await require("./ton.service").getAccount(address, network);
    if (!r.ok) return null;
    const out = [{ symbol: "TON", decimals: 9, amount: BigInt(r.nanotons || 0) }];
    for (const t of r.tokens || []) if (t.amount != null) out.push({ symbol: t.symbol, decimals: t.decimals, amount: BigInt(t.amount) });
    return out;
  }
  return null;
}

function units(amount, decimals) {
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "").slice(0, 8);
  return `${abs / base}${frac ? `.${frac}` : ""}`;
}

async function announceChainChange({ userId, chain, network, address, symbol, decimals, delta, now }) {
  const label = `${CHAIN_LABELS[chain] || chain}${network === "mainnet" ? "" : ` ${network}`}`;
  const what = `${units(delta < 0n ? -delta : delta, decimals)} ${symbol}`;
  if (delta > 0n) {
    return notifyActivity(userId, {
      category: "moneyIn",
      tag: `chain-${chain}-${symbol}-${now}`,
      url: "/app/wallet",
      symbol,
      title: `Received ${what}`,
      body: `Your ${label} wallet balance went up by ${what}.`,
      email: {
        subject: `You received ${what}`,
        intro: `Money has arrived in your ${label} wallet.`,
        tone: "pos",
        hero: { label: "Received", value: what, sub: `on ${label}` },
        rows: [
          { label: "Wallet", value: address, mono: true },
          { label: "Network", value: label },
        ],
      },
    });
  }
  return notifyActivity(userId, {
    category: "txUpdates",
    tag: `chain-${chain}-${symbol}-${now}`,
    url: "/app/wallet",
    symbol,
    title: `${what} left your ${label} wallet`,
    body: "If you did not send this, move what is left to a new wallet straight away.",
    email: {
      subject: `${what} left your ${label} wallet`,
      intro:
        "Your balance went down. If you sent this, there is nothing to do. If you did not, someone may have your recovery phrase: create a new wallet and move what is left to it straight away.",
      tone: "neg",
      hero: { label: "Left your wallet", value: what, sub: `on ${label}, including any network fee` },
      rows: [
        { label: "Wallet", value: address, mono: true },
        { label: "Network", value: label },
      ],
    },
  });
}

async function runChainWatchPass({ userId, now = Date.now() } = {}) {
  const startedAt = Date.now();
  const cutoff = new Date(now - CHAIN_WATCH_EVERY_MS);
  const query = { "chainAddresses.0": { $exists: true } };
  if (userId) query._id = userId;
  const users = await User.find(query).select("chainAddresses").lean();

  const jobs = [];
  for (const u of users) {
    for (const entry of u.chainAddresses || []) {
      if (entry.lastCheckedAt && entry.lastCheckedAt > cutoff) continue;
      jobs.push({ userId: u._id, ...entry, last: entry.lastCheckedAt ? new Date(entry.lastCheckedAt).getTime() : 0 });
    }
  }
  jobs.sort((a, b) => a.last - b.last);

  let checked = 0;
  let announced = 0;
  for (const job of jobs) {
    if (Date.now() - startedAt > CHAIN_WATCH_BUDGET_MS) break;
    checked += 1;
    let balances;
    try {
      balances = await readChainBalances(job.chain, job.network, job.address);
    } catch (err) {
      console.error(`[walletActivity] ${job.chain} balance read failed:`, err.message);
      balances = null;
    }
    const filter = { _id: job.userId, chainAddresses: { $elemMatch: { chain: job.chain, network: job.network, address: job.address } } };
    if (!balances) {
      await User.updateOne(filter, { $set: { "chainAddresses.$.lastCheckedAt": new Date() } }).catch(() => {});
      continue;
    }
    let previous = null;
    try {
      previous = job.lastBalance ? JSON.parse(job.lastBalance) : null;
    } catch {
      previous = null;
    }
    const next = Object.fromEntries(balances.map((b) => [b.symbol, b.amount.toString()]));
    const r = await User.updateOne(filter, {
      $set: { "chainAddresses.$.lastBalance": JSON.stringify(next), "chainAddresses.$.lastCheckedAt": new Date() },
    });
    if (!r.matchedCount || !previous) continue;
    for (const b of balances) {
      if (previous[b.symbol] == null) continue;
      const delta = b.amount - BigInt(previous[b.symbol]);
      if (delta === 0n) continue;
      announced += 1;
      announceChainChange({ userId: job.userId, chain: job.chain, network: job.network, address: job.address, symbol: b.symbol, decimals: b.decimals, delta, now }).catch(
        (err) => console.error("[walletActivity] chain notice failed:", err.message)
      );
    }
  }
  return { checked, announced, deferred: Math.max(0, jobs.length - checked) };
}

function _resetForTests() {
  inboundCheckedAt.clear();
  nativeSeen.clear();
}

module.exports = {
  _resetForTests,
  runChainWatchPass,
  readChainBalances,
  runInboundPass,
  checkNativeArrival,
  announceWalletTx,
  settleWalletTx,
  runWalletTxPass,
  eventForTx,
  UNSEEN_FAIL_AFTER_MS,
};
