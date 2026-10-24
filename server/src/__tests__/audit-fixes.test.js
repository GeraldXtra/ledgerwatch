process.env.SMTP_HOST = "";
process.env.SMTP_USER = "";
process.env.SMTP_PASS = "";
process.env.VAPID_PRIVATE_KEY = "";
process.env.TWILIO_ACCOUNT_SID = "";
process.env.ANTHROPIC_API_KEY = "";

const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Watch = require("../models/Watch");
const Alert = require("../models/Alert");
const Debt = require("../models/Debt");
const PaymentAddress = require("../models/PaymentAddress");
const { evaluateCondition } = require("../services/market.service");

let seq = 0;
const anEmail = () => `owner-${Date.now()}-${++seq}@example.com`;

describe("LW-044 — a percentage watch with no baseline must heal itself", () => {
  it("does not fire on a null baseline, rather than dividing by it", () => {
    const watch = { condition: { type: "drop_pct", value: 10 }, baselinePrice: null };
    expect(evaluateCondition(watch, 100)).toEqual({ hit: false, pctChange: null });
  });

  it("refuses a zero baseline for the right reason, not as 'missing'", () => {
    const watch = { condition: { type: "rise_pct", value: 10 }, baselinePrice: 0 };
    expect(evaluateCondition(watch, 100)).toEqual({ hit: false, pctChange: null });
  });

  it("evaluates normally once a baseline exists", () => {
    const drop = { condition: { type: "drop_pct", value: 10 }, baselinePrice: 100 };
    expect(evaluateCondition(drop, 89)).toMatchObject({ hit: true });
    expect(evaluateCondition(drop, 95)).toMatchObject({ hit: false });

    const rise = { condition: { type: "rise_pct", value: 10 }, baselinePrice: 100 };
    expect(evaluateCondition(rise, 111)).toMatchObject({ hit: true });
    expect(evaluateCondition(rise, 105)).toMatchObject({ hit: false });
  });
});

describe("A2-14 — a live alert must reach a terminal state", () => {
  async function aLiveAlert() {
    const user = await User.create({
      name: "Owner",
      email: anEmail(),
      passwordHash: "not-a-real-hash",
      tradingMode: "live",
    });
    const watch = await Watch.create({
      userId: user._id,
      mode: "live",
      coinId: "pepe",
      symbol: "PEPE",
      condition: { type: "rise_pct", value: 10 },
      baselinePrice: 1,
      active: true,
    });
    const alert = await Alert.create({
      userId: user._id,
      watchId: watch._id,
      mode: "live",
      coinId: "pepe",
      symbol: "PEPE",
      suggestion: "buy",
      priceAtAlert: 1.2,
      status: "pending",
    });
    return { user, watch, alert };
  }

  it("blocks its own watch for as long as it stays pending", async () => {
    const { watch, alert } = await aLiveAlert();
    const waiting = await Alert.exists({ mode: "live", watchId: watch._id, status: "pending" });
    expect(waiting).toBeTruthy();
    expect(alert.status).toBe("pending");
  });

  it("carries the fields needed to close it against a real transaction", async () => {
    const { alert } = await aLiveAlert();
    alert.status = "approved";
    alert.userAction = "buy";
    alert.txHash = `0x${"1".repeat(64)}`;
    alert.chainId = 8453;
    alert.actedAt = new Date();
    await alert.save();

    const closed = await Alert.findById(alert._id);
    expect(closed.status).toBe("approved");
    expect(closed.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(closed.chainId).toBe(8453);

    const waiting = await Alert.exists({
      mode: "live",
      watchId: closed.watchId,
      status: "pending",
    });
    expect(waiting).toBeFalsy();
  });
});

describe("A2-04 — Google sign-in must not adopt an unverified account", () => {
  it("an unverified row is the state that made the attack possible", async () => {
    const user = await User.create({
      name: "Victim",
      email: anEmail(),
      passwordHash: await bcrypt.hash("attacker-chosen-password", 10),
      emailVerified: false,
    });
    expect(user.emailVerified).toBe(false);
    expect(user.googleId).toBeFalsy();
  });

  it("claiming it rotates the password and bumps the session version", async () => {
    const attackerPassword = "attacker-chosen-password";
    const user = await User.create({
      name: "Victim",
      email: anEmail(),
      passwordHash: await bcrypt.hash(attackerPassword, 10),
      emailVerified: false,
      tokenVersion: 3,
    });

    const before = user.passwordHash;
    user.passwordHash = await bcrypt.hash("replacement-not-known-to-anyone", 10);
    user.tokenVersion = (Number(user.tokenVersion) || 0) + 1;
    user.googleId = "google-subject-id";
    user.emailVerified = true;
    await user.save();

    const after = await User.findById(user._id);
    expect(await bcrypt.compare(attackerPassword, after.passwordHash)).toBe(false);
    expect(after.passwordHash).not.toBe(before);
    expect(after.tokenVersion).toBe(4);
    expect(after.emailVerified).toBe(true);
  });

  it("leaves an already-verified account's sessions alone when linking", async () => {
    const user = await User.create({
      name: "Owner",
      email: anEmail(),
      passwordHash: await bcrypt.hash("their-own-password", 10),
      emailVerified: true,
      tokenVersion: 2,
    });
    const before = user.passwordHash;

    user.googleId = "google-subject-id";
    await user.save();

    const after = await User.findById(user._id);
    expect(after.tokenVersion).toBe(2);
    expect(after.passwordHash).toBe(before);
    expect(await bcrypt.compare("their-own-password", after.passwordHash)).toBe(true);
  });
});

describe("A3-03 — a fallback exchange rate must be recorded as one", () => {
  it("the address records whether its rate was live or a fallback", async () => {
    const user = await User.create({
      name: "Owner",
      email: anEmail(),
      passwordHash: "not-a-real-hash",
    });
    const debt = await Debt.create({
      userId: user._id,
      debtorName: "Zenith Trading",
      amount: 100000,
      dueDate: new Date(),
    });

    const pa = await PaymentAddress.create({
      userId: user._id,
      debtId: debt._id,
      chainId: 84532,
      derivationIndex: 0,
      address: `0x${"b".repeat(40)}`,
      tokenSymbol: "USDC",
      tokenContract: `0x${"c".repeat(40)}`,
      tokenDecimals: 6,
      invoiceBalanceNgn: 100000,
      expectedUsdc: 62.5,
      ngnPerUsd: 1600,
      rateTimestamp: new Date(),
      rateIsFallback: true,
      expiresAt: new Date(Date.now() + 3600 * 1000),
    });

    const stored = await PaymentAddress.findById(pa._id);
    expect(stored.rateIsFallback).toBe(true);
  });

  it("defaults to false, so an existing row is not mislabelled", async () => {
    const user = await User.create({
      name: "Owner",
      email: anEmail(),
      passwordHash: "not-a-real-hash",
    });
    const debt = await Debt.create({
      userId: user._id,
      debtorName: "Emeka Obi Ltd",
      amount: 50000,
      dueDate: new Date(),
    });
    const pa = await PaymentAddress.create({
      userId: user._id,
      debtId: debt._id,
      chainId: 84532,
      derivationIndex: 1,
      address: `0x${"d".repeat(40)}`,
      tokenSymbol: "USDC",
      tokenContract: `0x${"c".repeat(40)}`,
      tokenDecimals: 6,
      invoiceBalanceNgn: 50000,
      expectedUsdc: 31.25,
      ngnPerUsd: 1600,
      rateTimestamp: new Date(),
      expiresAt: new Date(Date.now() + 3600 * 1000),
    });
    expect((await PaymentAddress.findById(pa._id)).rateIsFallback).toBe(false);
  });
});
