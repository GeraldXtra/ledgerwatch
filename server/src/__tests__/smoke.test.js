/**
 * Harness smoke test — proves the test infrastructure itself works.
 *
 * This asserts nothing about application behaviour. Its whole job is to fail
 * loudly if the harness is broken, so that a later green suite means something.
 * Feature tests belong in files named for their defect ID (LW-002.test.js).
 */

const mongoose = require("mongoose");
const User = require("../models/User");
const Debt = require("../models/Debt");
const Payment = require("../models/Payment");

describe("test harness", () => {
  it("is connected to an ephemeral database, not the real one", () => {
    expect(mongoose.connection.readyState).toBe(1); // 1 = connected

    // The real development database is 127.0.0.1:27017/ledgerwatch and contains
    // real rows. If a test ever truncates that, it destroys the very evidence
    // LW-002 and LW-004 are documented from.
    expect(mongoose.connection.port).not.toBe(27017);
  });

  it("round-trips a User", async () => {
    await User.create({
      name: "Harness",
      email: "harness@example.com",
      passwordHash: "not-a-real-hash",
    });

    const found = await User.findOne({ email: "harness@example.com" });
    expect(found).not.toBeNull();
    expect(found.name).toBe("Harness");

    // Defaults the app relies on. tradingMode defaulting to anything other than
    // "paper" would be a live-trading safety failure.
    expect(found.tradingMode).toBe("paper");
    expect(found.autoSend.enabled).toBe(false);
  });

  it("round-trips a Debt and leaves derived fields absent", async () => {
    const user = await User.create({
      name: "Owner",
      email: "owner@example.com",
      passwordHash: "x",
    });

    const debt = await Debt.create({
      userId: user._id,
      debtorName: "Ada",
      amount: 10000,
      dueDate: new Date("2026-01-01"),
    });

    const found = await Debt.findById(debt._id);
    expect(found.amount).toBe(10000);
    expect(found.status).toBe("pending");

    // CLAUDE.md section 3: amountPaid, balance and displayStatus are attached at
    // READ time onto plain objects, never stored. Reading them off a document
    // yields undefined and silently collapses the arithmetic — that mistake has
    // already caused two real defects. If this ever starts passing a number,
    // the model gained a field and every guard downstream needs revisiting.
    expect(found.amountPaid).toBeUndefined();
    expect(found.balance).toBeUndefined();
    expect(found.displayStatus).toBeUndefined();
  });

  it("keeps indexes after truncation, so idempotency guards still bite", async () => {
    // afterEach truncates rather than drops precisely so this holds. The unique
    // sparse {txHash:1} index is what makes crypto settlement idempotent when the
    // watcher restarts mid-pass; a suite that lost it would prove the opposite
    // of what it claims.
    await Payment.syncIndexes();

    const user = await User.create({ name: "U", email: "u@example.com", passwordHash: "x" });
    const debt = await Debt.create({
      userId: user._id,
      debtorName: "B",
      amount: 500,
      dueDate: new Date(),
    });

    const row = { debtId: debt._id, userId: user._id, amount: 100, txHash: "0xdeadbeef" };
    await Payment.create(row);

    // Second insert of the same hash must be rejected by the database, not by
    // application logic. That is the whole point of the constraint.
    await expect(Payment.create(row)).rejects.toMatchObject({ code: 11000 });
  });

  it("isolates state between tests", async () => {
    // If afterEach did not truncate, the users created above would still be here.
    expect(await User.countDocuments()).toBe(0);
    expect(await Debt.countDocuments()).toBe(0);
    expect(await Payment.countDocuments()).toBe(0);
  });
});
