const mongoose = require("mongoose");
const User = require("../models/User");
const Debt = require("../models/Debt");
const Payment = require("../models/Payment");

describe("test harness", () => {
  it("is connected to an ephemeral database, not the real one", () => {
    expect(mongoose.connection.readyState).toBe(1);

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

    expect(found.amountPaid).toBeUndefined();
    expect(found.balance).toBeUndefined();
    expect(found.displayStatus).toBeUndefined();
  });

  it("keeps indexes after truncation, so idempotency guards still bite", async () => {
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

    await expect(Payment.create(row)).rejects.toMatchObject({ code: 11000 });
  });

  it("isolates state between tests", async () => {
    expect(await User.countDocuments()).toBe(0);
    expect(await Debt.countDocuments()).toBe(0);
    expect(await Payment.countDocuments()).toBe(0);
  });
});
