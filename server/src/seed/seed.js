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
const PaymentAddress = require("../models/PaymentAddress");
const PushSubscription = require("../models/PushSubscription");

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

const FALLBACK = { bitcoin: 95000, ethereum: 3200, solana: 180 };

const ONLY_SEEDABLE_EMAIL = "demo@ledgerwatch.app";
const FORCED = process.argv.includes("--force");

function abort(message) {
  console.error(`\n  ✖ ${message}\n`);
  process.exitCode = 1;
}

async function main() {
  await connectDB();

  if (DEMO.email !== ONLY_SEEDABLE_EMAIL) {
    abort(
      `Refusing to seed "${DEMO.email}". This script may only ever target ` +
        `${ONLY_SEEDABLE_EMAIL}. Seeding any other account is not supported.`
    );
    return null;
  }

  const existing = await User.findOne({ email: DEMO.email });
  if (existing) {
    const uid = existing._id;
    const [debts, payments, reminders, watches, alerts, trades] = await Promise.all([
      Debt.countDocuments({ userId: uid }),
      Payment.countDocuments({ userId: uid }),
      Reminder.countDocuments({ userId: uid }),
      Watch.countDocuments({ userId: uid }),
      Alert.countDocuments({ userId: uid }),
      SimTrade.countDocuments({ userId: uid }),
    ]);
    const total = debts + payments + reminders + watches + alerts + trades;

    console.log("\n========================================");
    console.log("  ⚠  DESTRUCTIVE OPERATION");
    console.log("========================================");
    console.log(`  Account : ${DEMO.email}`);
    console.log(`  Database: ${mongoose.connection.name} @ ${mongoose.connection.host}`);
    console.log("  ----------------------------------------");
    console.log(`  Will PERMANENTLY DELETE ${total} record(s) on this account:`);
    console.log(`    debts ${debts} · payments ${payments} · reminders ${reminders}`);
    console.log(`    watches ${watches} · alerts ${alerts} · sim trades ${trades}`);
    console.log("  Anything created through the UI on this account is included.");
    console.log("========================================\n");

    if (!FORCED) {
      abort(
        "Nothing was deleted. Re-run with --force if you really want to wipe and\n" +
          "    reseed that account:   npm run seed:demo -- --force"
      );
      return null;
    }
    console.log("  --force given, proceeding with the wipe...\n");
  }

  const passwordHash = await bcrypt.hash(DEMO.password, 10);
  let user = await User.findOne({ email: DEMO.email });
  if (user) {
    user.name = DEMO.name;
    user.passwordHash = passwordHash;
    user.bankDetails = DEMO.bankDetails;
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

  await Promise.all([
    Debt.deleteMany({ userId }),
    Payment.deleteMany({ userId }),
    Reminder.deleteMany({ userId }),
    Watch.deleteMany({ userId }),
    Alert.deleteMany({ userId }),
    SimTrade.deleteMany({ userId }),
    Portfolio.deleteMany({ userId }),
    WalletTx.deleteMany({ userId }),
    PaymentAddress.deleteMany({ userId }),
    PushSubscription.deleteMany({ userId }),
    User.updateOne(
      { _id: userId },
      { $set: { walletHistoryCursors: [], discoveredTokens: [] } }
    ),
  ]);

  const priceRows = await getPrices(["bitcoin", "ethereum", "solana"]);
  const pricesLive = Boolean(priceRows.bitcoin && priceRows.bitcoin.usd);
  const priceOf = (id) => (priceRows[id] && priceRows[id].usd) || FALLBACK[id];
  const btc = priceOf("bitcoin");
  const eth = priceOf("ethereum");
  const sol = priceOf("solana");

  const debtSpecs = [
    { debtorName: "Dangote Cement Plc", debtorPhone: "08031234567", amount: 42500000, createdDays: -152, dueDays: -122, note: "Q1 haulage and logistics contract", payments: [{ amount: 42500000, days: -119, method: "transfer" }] },
    { debtorName: "Dangote Cement Plc", debtorPhone: "08031234567", amount: 118750000, createdDays: -84, dueDays: -54, note: "Bulk cement distribution, 12 depots", payments: [{ amount: 118750000, days: -50, method: "transfer" }] },
    { debtorName: "Dangote Cement Plc", debtorPhone: "08031234567", amount: 96400000, createdDays: -27, dueDays: -9, note: "Fleet servicing retainer, Q3", payments: [{ amount: 45000000, days: -6, method: "transfer" }] },

    { debtorName: "Zenith Bank Plc", debtorPhone: "08062345678", amount: 27300000, createdDays: -128, dueDays: -98, note: "Branch fit-out, phase one", payments: [{ amount: 27300000, days: -46, method: "transfer" }] },
    { debtorName: "Zenith Bank Plc", debtorPhone: "08062345678", amount: 64800000, createdDays: -68, dueDays: -44, note: "ATM network maintenance, H2", payments: [] },

    { debtorName: "Julius Berger", debtorPhone: "08088123456", amount: 38600000, createdDays: -104, dueDays: -76, note: "Site equipment leasing, Q2", payments: [{ amount: 9600000, days: -60, method: "transfer" }] },

    { debtorName: "Flour Mills of Nigeria", debtorPhone: "08023456789", amount: 152000000, createdDays: -8, dueDays: 22, note: "Grain silo construction, milestone 2", payments: [{ amount: 60000000, days: -3, method: "transfer" }] },

    { debtorName: "MTN Nigeria", debtorPhone: "08094567890", amount: 18500000, createdDays: -97, dueDays: -67, note: "Managed IT services, monthly", payments: [{ amount: 18500000, days: -71, method: "transfer" }] },
    { debtorName: "MTN Nigeria", debtorPhone: "08094567890", amount: 18500000, createdDays: -66, dueDays: -36, note: "Managed IT services, monthly", payments: [{ amount: 18500000, days: -40, method: "transfer" }] },
    { debtorName: "MTN Nigeria", debtorPhone: "08094567890", amount: 21750000, createdDays: -4, dueDays: 26, note: "Managed IT services, monthly", payments: [] },

    { debtorName: "Lafarge Africa", debtorPhone: "08051239876", amount: 8900000, createdDays: -23, dueDays: -8, note: "Plant safety audit and certification", payments: [{ amount: 8900000, days: -1, method: "transfer" }], reminded: true },

    { debtorName: "GTCO Plc", debtorPhone: "08077654321", amount: 74200000, createdDays: -142, dueDays: -112, note: "Core banking migration, phase three", payments: [{ amount: 12000000, days: -95, method: "transfer" }] },
  ];

  const debtorEmails = {
    "Dangote Cement Plc": "accounts.payable@dangote.example.com",
    "Zenith Bank Plc": "vendor.payments@zenith.example.com",
    "Flour Mills of Nigeria": "finance@flourmills.example.com",
    "MTN Nigeria": "supplier.billing@mtn.example.com",
    "Lafarge Africa": "ap.team@lafarge.example.com",
    "GTCO Plc": "procurement@gtco.example.com",
    "Julius Berger": "accounts@juliusberger.example.com",
  };

  let settledDebt = null;
  let settledRemindedAt = null;
  for (const d of debtSpecs) {
    const createdAt = rel(d.createdDays);
    const paidTotal = d.payments.reduce((s, p) => s + p.amount, 0);
    let status = "pending";
    if (paidTotal >= d.amount) status = "paid";
    else if (paidTotal > 0) status = "partially_paid";

    const history = [{ at: createdAt, event: "created" }];
    if (d.reminded) {
      settledRemindedAt = rel(d.dueDays + 2);
      history.push({ at: settledRemindedAt, event: "reminded" });
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
      lastRemindedAt: d.reminded ? settledRemindedAt : null,
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

    if (d.debtorName === "Lafarge Africa") settledDebt = debt;
  }

  if (settledDebt) {
    await Reminder.create({
      debtId: settledDebt._id,
      userId,
      messageText: buildReminderMessage({
        debtorName: settledDebt.debtorName,
        amount: settledDebt.amount,
        currency: "NGN",
        dueDate: settledDebt.dueDate,
        daysOverdue: 2,
        tone: "gentle",
        bankDetails: DEMO.bankDetails,
        ownerName: DEMO.name,
      }),
      scheduledFor: settledRemindedAt || rel(-5),
      status: "cancelled",
      createdAt: settledRemindedAt || rel(-5),
    });
  }

  const guaranteedValue = pricesLive ? Math.ceil(btc * 1.5) : 100000000;
  const btcWatch = await createWatch(userId, { symbol: "BTC", type: "price_below", value: guaranteedValue });
  const ethWatch = await createWatch(userId, { symbol: "ETH", type: "drop_pct", value: 0.5 });
  const solWatch = await createWatch(userId, { symbol: "SOL", type: "rise_pct", value: 0.5 });

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
    await approveAlert(userId, alert);
  }
  await seedApprovedBuy(btcWatch, "bitcoin", "BTC", btc);
  await seedApprovedBuy(ethWatch, "ethereum", "ETH", eth);

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

if (require.main === module) {
  main()
    .then(async (result) => {
      if (result === null) {
        try {
          await mongoose.disconnect();
        } catch {
        }
        process.exit(process.exitCode || 1);
      }
    })
    .catch(async (err) => {
      console.error("\n❌ Seed failed:", err.message);
      try {
        await mongoose.disconnect();
      } catch {
      }
      process.exit(1);
    });
}
