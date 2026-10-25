const axios = require("axios");
const mongoose = require("mongoose");
const User = require("../models/User");
const Watch = require("../models/Watch");
const Alert = require("../models/Alert");
const cg = require("../services/coingecko.service");
const { runPricePass } = require("../services/market.service");

let savedBudget;

beforeEach(async () => {
  savedBudget = process.env.PRICE_PASS_BUDGET_MS;
  await Promise.all([Watch.deleteMany({}), Alert.deleteMany({}), User.deleteMany({})]);
  cg._resetForTests();
  vi.spyOn(axios, "get").mockImplementation(async (url, opts = {}) => {
    const ids = String((opts.params && opts.params.ids) || "").split(",").filter(Boolean);
    return { data: ids.map((id) => ({ id, symbol: id.slice(0, 3), name: id, current_price: 100 })) };
  });
});

afterEach(() => {
  if (savedBudget === undefined) delete process.env.PRICE_PASS_BUDGET_MS;
  else process.env.PRICE_PASS_BUDGET_MS = savedBudget;
  vi.restoreAllMocks();
});

async function threeWatches() {
  const user = await User.create({ name: "Budget", email: `budget-${Date.now()}@example.com`, passwordHash: "x" });
  const made = [];
  for (const coinId of ["alpha", "bravo", "charlie"]) {
    made.push(
      await Watch.create({
        _id: new mongoose.Types.ObjectId(),
        userId: user._id,
        coinId,
        symbol: coinId.slice(0, 3),
        condition: { type: "price_above", value: 1 },
        active: true,
      })
    );
  }
  return made.sort((a, b) => (String(a._id) < String(b._id) ? -1 : 1));
}

describe("LW-133 — the price pass has a time budget and never starves a watch", () => {
  it("checks every watch when there is time", async () => {
    await threeWatches();
    const out = await runPricePass();
    expect(out).toMatchObject({ watchesChecked: 3, watchesDeferred: 0, alertsCreated: 3 });
  });

  it("stops at the budget and starts the next pass with the watches it deferred", async () => {
    const watches = await threeWatches();
    process.env.PRICE_PASS_BUDGET_MS = "1";

    const seen = [];
    for (let pass = 0; pass < 3; pass++) {
      const before = new Set((await Alert.find({}).select("watchId")).map((a) => String(a.watchId)));
      const out = await runPricePass();
      expect(out.watchesChecked).toBeGreaterThanOrEqual(1);
      if (pass === 0) expect(out.watchesDeferred).toBeGreaterThan(0);
      const after = (await Alert.find({}).select("watchId")).map((a) => String(a.watchId));
      seen.push(...after.filter((id) => !before.has(id)));
      if (out.watchesDeferred === 0) break;
    }

    expect(new Set(seen)).toEqual(new Set(watches.map((w) => String(w._id))));
  });

  it("refuses a budget that is not a positive number and uses the default", async () => {
    await threeWatches();
    process.env.PRICE_PASS_BUDGET_MS = "soon";
    const out = await runPricePass();
    expect(out.watchesDeferred).toBe(0);
    expect(out.watchesChecked).toBe(3);
  });
});
