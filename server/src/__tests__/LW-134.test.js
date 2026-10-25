const mongoose = require("mongoose");
const Alert = require("../models/Alert");
const { dedupeAlerts } = require("../scripts/dedupe-alerts");

async function stacked() {
  const userId = new mongoose.Types.ObjectId();
  const watchId = new mongoose.Types.ObjectId();
  const base = { userId, watchId, coinId: "bitcoin", symbol: "BTC", message: "m", suggestion: "buy", mode: "paper", status: "pending" };
  await Alert.create({ ...base, createdAt: new Date(Date.now() - 2000) });
  await Alert.create({ ...base, createdAt: new Date(Date.now() - 1000) });
  await Alert.create({ ...base, createdAt: new Date() });
  await Alert.create({ ...base, watchId: new mongoose.Types.ObjectId() });
}

beforeEach(async () => {
  await Alert.deleteMany({});
});

describe("LW-134 — the alert cleanup previews before it writes", () => {
  it("changes nothing without --apply and reports what it would do", async () => {
    await stacked();
    const out = await dedupeAlerts();
    expect(out).toMatchObject({ apply: false, scanned: 4, kept: 2, stale: 2, dismissed: 0 });
    expect(await Alert.countDocuments({ status: "pending" })).toBe(4);
  });

  it("dismisses the older duplicates with --apply and keeps the newest per watch", async () => {
    await stacked();
    const out = await dedupeAlerts({ apply: true });
    expect(out).toMatchObject({ apply: true, stale: 2, dismissed: 2 });
    expect(await Alert.countDocuments({ status: "pending" })).toBe(2);
    expect(await Alert.countDocuments({ status: "dismissed" })).toBe(2);
  });
});
