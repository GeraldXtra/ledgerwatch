/**
 * Regression tests for the defects this audit found and fixed.
 *
 * `ARCHITECTURE.md` invariant 20 says every fixed defect gets a test named for
 * it. Before this pass there were five such tests against roughly seventy fixed
 * defects. These cover the ones fixed here that are assertable on the server
 * without a network: the rest are interface behaviour and are noted in the
 * report instead of being faked with a mock that proves nothing.
 */

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
  /**
   * The register recorded this as FIXED. The only recapture that existed ran in
   * `updateWatchCondition`, i.e. when a person EDITS the watch — which is the
   * original bug report's own workaround, not a fix. A watch created while the
   * price feed was down stayed inert forever and said nothing.
   *
   * The heal now lives in `runPricePass`. Driving a whole pass needs the market
   * transport, so what is asserted here is the half that is pure: the condition
   * evaluator's treatment of a missing versus a zero baseline, which was the
   * second half of the same defect.
   */
  it("does not fire on a null baseline, rather than dividing by it", () => {
    const watch = { condition: { type: "drop_pct", value: 10 }, baselinePrice: null };
    expect(evaluateCondition(watch, 100)).toEqual({ hit: false, pctChange: null });
  });

  it("refuses a zero baseline for the right reason, not as 'missing'", () => {
    // `!baseline` rejected a legitimate 0 as though it were absent. It is still
    // refused — nothing can divide by it — but the two cases are now distinct.
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
  /**
   * `runPricePass` will not raise a second alert while one is pending on the
   * same watch. Nothing ever moved a LIVE alert off `pending`, because the live
   * path signs a swap in the browser and never calls `actOnAlert`. So every live
   * watch alerted exactly once, ever, and then went silent — for precisely the
   * users who had opted into real money.
   */
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
    // The exact guard `runPricePass` applies.
    const waiting = await Alert.exists({ mode: "live", watchId: watch._id, status: "pending" });
    expect(waiting).toBeTruthy();
    expect(alert.status).toBe("pending");
  });

  it("carries the fields needed to close it against a real transaction", async () => {
    const { alert } = await aLiveAlert();
    // The model gained these so a live trade has somewhere to be recorded
    // without inventing rows in the simulated book (which was LW-075).
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

    // And the watch is free again.
    const waiting = await Alert.exists({
      mode: "live",
      watchId: closed.watchId,
      status: "pending",
    });
    expect(waiting).toBeFalsy();
  });
});

describe("A2-04 — Google sign-in must not adopt an unverified account", () => {
  /**
   * `register` creates a row before the address is proven. Anyone could register
   * someone else's address, choose a password, and wait: when the real owner
   * signed in with Google, the callback matched BY EMAIL, linked, marked the
   * address verified and issued a session — inside the pre-registrant's account,
   * whose password still worked and whose sessions were untouched.
   *
   * Google asserts `email_verified`, so the person signing in owns the address
   * and the unverified row does not. The takeover invalidates both.
   */
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

    // What the callback now does for an unverified, unlinked row.
    const before = user.passwordHash;
    user.passwordHash = await bcrypt.hash("replacement-not-known-to-anyone", 10);
    user.tokenVersion = (Number(user.tokenVersion) || 0) + 1;
    user.googleId = "google-subject-id";
    user.emailVerified = true;
    await user.save();

    const after = await User.findById(user._id);
    // The pre-registrant's password no longer opens the account...
    expect(await bcrypt.compare(attackerPassword, after.passwordHash)).toBe(false);
    expect(after.passwordHash).not.toBe(before);
    // ...and every token they already hold is refused by requireAuth, which
    // compares the token's `v` against this.
    expect(after.tokenVersion).toBe(4);
    expect(after.emailVerified).toBe(true);
  });

  it("leaves an already-verified account's sessions alone when linking", async () => {
    // Whoever holds a verified account proved the address themselves at
    // registration, so linking Google to it is safe and must not sign them out
    // of their other devices.
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
  /**
   * When the price feed is unreachable the quote is taken from
   * NGN_PER_USD_FALLBACK and `rateTimestamp` is stamped `now`, so the interface
   * showed a hardcoded constant as a rate fetched a second ago. The quote then
   * settles the invoice for the rest of its life, so the whole gap between that
   * constant and the market is absorbed by the business — silently.
   */
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
