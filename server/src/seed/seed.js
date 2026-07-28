/**
 * LedgerWatch demo seed — idempotent, date-relative, math-consistent.
 *
 *   cd server && npm run seed
 *
 * Creates/refreshes ONE demo user and seeds a lived-in ledger + market state.
 * Running it twice never duplicates: it deletes only the demo user's own data
 * first, then reseeds. No other user is touched. All dates are computed from
 * "now" so the demo stays fresh however many days pass before the presentation.
 */
require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const connectDB = require("../config/db");

const User = require("../models/User");
const Debt = require("../models/Debt");
const Payment = require("../models/Payment");
const Reminder = require("../models/Reminder");
const Watch = require("../models/Watch");
const Alert = require("../models/Alert");
const SimTrade = require("../models/SimTrade");
const Portfolio = require("../models/Portfolio");
const WalletTx = require("../models/WalletTx");

const { getPrices } = require("../services/coingecko.service");
const { createWatch, approveAlert, getPortfolio } = require("../services/market.service");
const { buildReminderMessage } = require("../utils/reminderTemplate");
const { analytics, debtorGroups } = require("../services/receivables.service");

const DAY = 24 * 60 * 60 * 1000;
const rel = (days) => new Date(Date.now() + days * DAY);
const usd = (n) => `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const ngn = (n) => `NGN ${Number(n).toLocaleString("en-NG")}`;

const DEMO = {
  name: "Demo Ventures",
  email: "demo@ledgerwatch.app",
  password: "demo1234",
  bankDetails: {
    accountName: "Demo Ventures Ltd",
    accountNumber: "0123456789",
    bankName: "GTBank",
  },
};

// Fallback prices so the seed never fails if CoinGecko is unreachable.
const FALLBACK = { bitcoin: 95000, ethereum: 3200, solana: 180 };

async function main() {
  await connectDB();

  // 1) Upsert the demo user (stable _id across runs).
  const passwordHash = await bcrypt.hash(DEMO.password, 10);
  let user = await User.findOne({ email: DEMO.email });
  if (user) {
    user.name = DEMO.name;
    user.passwordHash = passwordHash;
    user.bankDetails = DEMO.bankDetails;
    // Reset the opt-in surfaces too, so a re-seed always lands on the shipped
    // defaults: automatic sending OFF, and no wallet address advertised (the
    // encrypted keystore lives in the browser, so a stale address here would
    // claim a wallet the client has no key for).
    user.autoSend = { enabled: false, whatsapp: false, email: false };
    user.walletAddress = null;
    await user.save();
  } else {
    user = await User.create({
      name: DEMO.name,
      email: DEMO.email,
      passwordHash,
      bankDetails: DEMO.bankDetails,
    });
  }
  const userId = user._id;

  // 2) Wipe ONLY this user's data (scoped — never touches other users).
  await Promise.all([
    Debt.deleteMany({ userId }),
    Payment.deleteMany({ userId }),
    Reminder.deleteMany({ userId }),
    Watch.deleteMany({ userId }),
    Alert.deleteMany({ userId }),
    SimTrade.deleteMany({ userId }),
    Portfolio.deleteMany({ userId }),
    WalletTx.deleteMany({ userId }), // locally-recorded testnet tx history
  ]);

  // 3) Live prices once (fallback if CoinGecko is down).
  const priceRows = await getPrices(["bitcoin", "ethereum", "solana"]);
  const pricesLive = Boolean(priceRows.bitcoin && priceRows.bitcoin.usd);
  const priceOf = (id) => (priceRows[id] && priceRows[id].usd) || FALLBACK[id];
  const btc = priceOf("bitcoin");
  const eth = priceOf("ethereum");
  const sol = priceOf("solana");

  // 4) Debts spread over ~6 months with real payments, so debtor profiles,
  //    reliability scores, aging, and the 6-month charts all populate. Multiple
  //    debts per debtor give history. Status is derived from payments.
  //    payments[].days is relative to now; method cash/transfer/other.
  const debtSpecs = [
    // Chidi Okafor — reliable repeat customer (Good): pays close to on time.
    { debtorName: "Chidi Okafor", debtorPhone: "08031234567", amount: 60000, createdDays: -150, dueDays: -140, note: "Ankara fabric supply", payments: [{ amount: 60000, days: -142, method: "transfer" }] },
    { debtorName: "Chidi Okafor", debtorPhone: "08031234567", amount: 90000, createdDays: -80, dueDays: -70, note: "Bulk lace order", payments: [{ amount: 90000, days: -66, method: "transfer" }] },
    { debtorName: "Chidi Okafor", debtorPhone: "08031234567", amount: 85000, createdDays: -25, dueDays: -10, note: "Ankara supply, 20 yards", payments: [{ amount: 40000, days: -8, method: "cash" }] }, // partial + overdue

    // Amara Nwosu — risky payer (Risky): one very late, one unpaid and overdue.
    { debtorName: "Amara Nwosu", debtorPhone: "08062345678", amount: 50000, createdDays: -120, dueDays: -110, note: "Hair extensions", payments: [{ amount: 50000, days: -70, method: "transfer" }] }, // ~40 days late
    { debtorName: "Amara Nwosu", debtorPhone: "08062345678", amount: 42000, createdDays: -18, dueDays: -4, note: "Bulk hair extensions", payments: [] }, // overdue, unpaid

    // Tunde Bakare — new customer, part-paid, not yet due (New).
    { debtorName: "Tunde Bakare", debtorPhone: "08023456789", amount: 120000, createdDays: -6, dueDays: 3, note: "Catering deposit balance", payments: [{ amount: 50000, days: -2, method: "transfer" }] }, // partial, upcoming

    // Zainab Bello — excellent, always on time (Excellent).
    { debtorName: "Zainab Bello", debtorPhone: "08094567890", amount: 30000, createdDays: -95, dueDays: -88, note: "Social-media retainer", payments: [{ amount: 30000, days: -89, method: "transfer" }] },
    { debtorName: "Zainab Bello", debtorPhone: "08094567890", amount: 30000, createdDays: -60, dueDays: -53, note: "Social-media retainer", payments: [{ amount: 30000, days: -54, method: "transfer" }] },
    { debtorName: "Zainab Bello", debtorPhone: "08094567890", amount: 30000, createdDays: -2, dueDays: 14, note: "Social-media retainer", payments: [] }, // upcoming

    // Emeka Obi — settled late (Fair). Keeps the cancel-on-paid story.
    { debtorName: "Emeka Obi", debtorPhone: "08051239876", amount: 65000, createdDays: -20, dueDays: -7, note: "POS machine installment", payments: [{ amount: 65000, days: -1, method: "cash" }], reminded: true },
  ];

  // One email per debtor (repeated across their debts, so debtor grouping is
  // unaffected). @example.com is reserved by RFC 2606 and is not routable, so a
  // demo send can never reach a real stranger — swap in your own address to watch
  // a branded reminder actually land in an inbox.
  const debtorEmails = {
    "Chidi Okafor": "chidi.okafor@example.com",
    "Amara Nwosu": "amara.nwosu@example.com",
    "Tunde Bakare": "tunde.bakare@example.com",
    "Zainab Bello": "zainab.bello@example.com",
    "Emeka Obi": "emeka.obi@example.com",
  };

  let emekaDebt = null;
  let emekaRemindedAt = null;
  for (const d of debtSpecs) {
    const createdAt = rel(d.createdDays);
    const paidTotal = d.payments.reduce((s, p) => s + p.amount, 0);
    let status = "pending";
    if (paidTotal >= d.amount) status = "paid";
    else if (paidTotal > 0) status = "partially_paid";

    const history = [{ at: createdAt, event: "created" }];
    if (d.reminded) {
      emekaRemindedAt = rel(d.dueDays + 2);
      history.push({ at: emekaRemindedAt, event: "reminded" });
    }
    for (const p of d.payments) history.push({ at: rel(p.days), event: "payment_received" });
    if (status === "paid") {
      const lastPay = Math.max(...d.payments.map((p) => p.days));
      history.push({ at: rel(lastPay), event: "marked_paid" });
    }

    const debt = await Debt.create({
      userId,
      debtorName: d.debtorName,
      debtorPhone: d.debtorPhone,
      debtorEmail: debtorEmails[d.debtorName] || undefined,
      amount: d.amount,
      currency: "NGN",
      dueDate: rel(d.dueDays),
      note: d.note,
      status,
      lastRemindedAt: d.reminded ? emekaRemindedAt : null, // overdue ones stay null so the first pass reminds them
      history,
      createdAt,
    });

    for (const p of d.payments) {
      await Payment.create({
        debtId: debt._id,
        userId,
        amount: p.amount,
        method: p.method || "transfer",
        paidAt: rel(p.days),
        createdAt: rel(p.days),
      });
    }

    if (d.debtorName === "Emeka Obi") emekaDebt = debt;
  }

  // Emeka's cancelled reminder (the cancel-on-paid story) referencing his balance.
  if (emekaDebt) {
    await Reminder.create({
      debtId: emekaDebt._id,
      userId,
      messageText: buildReminderMessage({
        debtorName: emekaDebt.debtorName,
        amount: emekaDebt.amount,
        currency: "NGN",
        dueDate: emekaDebt.dueDate,
        daysOverdue: 2,
        tone: "gentle",
        bankDetails: DEMO.bankDetails,
        ownerName: DEMO.name,
      }),
      scheduledFor: emekaRemindedAt || rel(-5),
      status: "cancelled",
      createdAt: emekaRemindedAt || rel(-5),
    });
  }

  // 5) Watches — one guaranteed to trigger, two loose. createWatch captures the
  //    baseline. price_below with a threshold well above the live price fires on
  //    the first pass no matter what the market does.
  const guaranteedValue = pricesLive ? Math.ceil(btc * 1.5) : 100000000;
  const btcWatch = await createWatch(userId, { symbol: "BTC", type: "price_below", value: guaranteedValue });
  const ethWatch = await createWatch(userId, { symbol: "ETH", type: "drop_pct", value: 0.5 });
  const solWatch = await createWatch(userId, { symbol: "SOL", type: "rise_pct", value: 0.5 });

  // 6) Two approved trades — applied through the SAME service the app uses, so
  //    the portfolio math (cash, holdings, avgBuyPrice, P/L) is provably coherent.
  async function seedApprovedBuy(watch, coinId, symbol, price) {
    const alert = await Alert.create({
      userId,
      watchId: watch._id,
      coinId,
      symbol,
      message: `${symbol} reached your buy zone — suggested: buy.`,
      suggestion: "buy",
      priceAtAlert: price,
      status: "pending",
    });
    await approveAlert(userId, alert); // -> SimTrade + Portfolio update per §2a
  }
  await seedApprovedBuy(btcWatch, "bitcoin", "BTC", btc);
  await seedApprovedBuy(ethWatch, "ethereum", "ETH", eth);

  // 7) One PENDING alert (SOL buy) so the approve flow is demoable instantly —
  //    approving it opens a fresh SOL position (a visible portfolio move).
  await Alert.create({
    userId,
    watchId: solWatch._id,
    coinId: "solana",
    symbol: "SOL",
    message: "SOL is breaking out — the agent suggests opening a small position.",
    suggestion: "buy",
    priceAtAlert: sol,
    status: "pending",
  });

  // 8) Summary.
  const portfolio = await getPortfolio(userId);
  const debts = await Debt.find({ userId });
  const paymentCount = await Payment.countDocuments({ userId });
  const stats = await analytics(userId);
  const debtors = await debtorGroups(userId);
  const cb = stats.countByStatus;

  console.log("\n========================================");
  console.log("  LedgerWatch demo data seeded");
  console.log("========================================");
  console.log(`  Login:     ${DEMO.email} / ${DEMO.password}`);
  console.log(`  Bank:      ${DEMO.bankDetails.accountName} · ${DEMO.bankDetails.bankName} · ${DEMO.bankDetails.accountNumber}`);
  console.log(`  Prices:    ${pricesLive ? "live from CoinGecko" : "FALLBACK (CoinGecko unreachable)"}`);
  console.log("  ----------------------------------------");
  console.log(`  Debts:     ${debts.length} across ${debtors.length} debtors, ${paymentCount} payments`);
  console.log(`             pending ${cb.pending}, partial ${cb.partially_paid}, overdue ${cb.overdue}, paid ${cb.paid}`);
  console.log(`             every debtor has a phone + an @example.com email, so`);
  console.log(`             Send WhatsApp / Send Email / Send Both are all demoable`);
  console.log(`  Outstanding: ${ngn(stats.totalOutstanding)}  ·  collection rate ${stats.collectionRate}%`);
  console.log("  Debtor reliability:");
  for (const d of debtors) {
    console.log(`   - ${d.debtorName}: ${d.reliabilityScore == null ? "New" : d.reliabilityScore + " " + d.band}  (outstanding ${ngn(d.totalOutstanding)})`);
  }
  console.log("  ----------------------------------------");
  console.log("  Watches:   3");
  console.log(`   - BTC  price_below ${usd(guaranteedValue)}  <- GUARANTEED to fire next pass (buy)`);
  console.log(`   - ETH  drop 0.5%  (baseline ${usd(eth)})`);
  console.log(`   - SOL  rise 0.5%  (baseline ${usd(sol)})`);
  console.log("  ----------------------------------------");
  console.log("  Portfolio (2 approved buys applied via §2a rules):");
  console.log(`   - Cash:        ${usd(portfolio.cashBalance)}`);
  for (const h of portfolio.holdings) {
    console.log(`   - ${h.symbol}: qty ${h.qty.toLocaleString("en-US", { maximumFractionDigits: 6 })} @ avg ${usd(h.avgBuyPrice)} = ${h.value != null ? usd(h.value) : "n/a"}`);
  }
  console.log(`   - Total value: ${usd(portfolio.totalValue)}`);
  console.log(`   - Total P/L:   ${portfolio.totalPnl >= 0 ? "+" : "-"}${usd(Math.abs(portfolio.totalPnl))}`);
  console.log("  ----------------------------------------");
  console.log("  Alerts:    1 pending (SOL buy) — approve it to open a new position");
  console.log("  ----------------------------------------");
  console.log("  Wallet:    reset — autoSend OFF, no address, no tx history.");
  console.log("             The encrypted keystore lives in the BROWSER, so a seed");
  console.log("             cannot clear it; use 'Remove wallet' in the UI for that.");
  console.log("========================================\n");

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("\n❌ Seed failed:", err.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
