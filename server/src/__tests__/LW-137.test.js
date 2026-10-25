process.env.JWT_SECRET = process.env.JWT_SECRET || "lw-tenancy-tests-only-0123456789abcdefghijk";

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { ESLint } = require("eslint");
const app = require("../app");
const User = require("../models/User");
const Debt = require("../models/Debt");
const Watch = require("../models/Watch");
const signToken = require("../utils/token");
const { scopedRepo, scopedModel, TENANT_MODELS } = require("../repositories/scoped");
const { deleteAccount } = require("../controllers/account.controller");

let server;
let base;
let seq = 0;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function anAccount(extra = {}) {
  const user = await User.create({ name: "Tenant", email: `tenant-${Date.now()}-${++seq}@example.com`, passwordHash: "x", emailVerified: true, ...extra });
  return { user, token: signToken(user._id, user.tokenVersion) };
}

describe("LW-137 — every query is scoped to the signed-in account", () => {
  it("adds the owner to every filter, even one that names another account", async () => {
    const a = await anAccount();
    const b = await anAccount();
    await Debt.create({ userId: a.user._id, debtorName: "A", amount: 1, dueDate: new Date() });
    await Debt.create({ userId: b.user._id, debtorName: "B", amount: 1, dueDate: new Date() });
    const debts = scopedRepo(a.user._id).debts;
    expect((await debts.find({})).map((d) => d.debtorName)).toEqual(["A"]);
    expect((await debts.find({ userId: b.user._id })).map((d) => d.debtorName)).toEqual(["A"]);
    expect(await debts.countDocuments({ debtorName: "B" })).toBe(0);
    const [summary] = await debts.aggregate([{ $group: { _id: null, n: { $sum: 1 } } }]);
    expect(summary.n).toBe(1);
  });

  it("stamps the owner on what it creates and refuses to move a record to another account", async () => {
    const a = await anAccount();
    const b = await anAccount();
    const watches = scopedModel(Watch, a.user._id);
    const watch = await watches.create({ userId: b.user._id, coinId: "bitcoin", symbol: "BTC", condition: { type: "price_above", value: 1 } });
    expect(String(watch.userId)).toBe(String(a.user._id));
    expect(() => watches.updateOne({ _id: watch._id }, { $set: { userId: b.user._id } })).toThrow(/cannot change which account owns/);
    expect(() => watches.updateMany({}, { userId: b.user._id })).toThrow(/cannot change which account owns/);
  });

  it("will not change sign-in details through a plain account update", async () => {
    const a = await anAccount();
    const self = scopedRepo(a.user._id).self;
    expect(() => self.update({ $set: { passwordHash: "y" } })).toThrow(/Sign-in details/);
    expect(() => self.update({ email: "other@example.com" })).toThrow(/Sign-in details/);
    expect(() => self.updateOne({ $inc: { tokenVersion: 1 } })).toThrow(/Sign-in details/);
    const updated = await self.update({ $set: { companyName: "Kept" } });
    expect(updated.companyName).toBe("Kept");
  });

  it("needs a real account id, and treats a malformed record id as not found", async () => {
    expect(() => scopedRepo("not-an-id")).toThrow(/signed-in account/);
    expect(() => scopedRepo(undefined)).toThrow(/signed-in account/);
    const a = await anAccount();
    expect(await scopedRepo(a.user._id).debts.findById("nope")).toBeNull();
  });

  it("keeps one account's records out of reach of another over the real routes", async () => {
    const a = await anAccount();
    const b = await anAccount();
    const debt = await Debt.create({ userId: b.user._id, debtorName: "Private", amount: 10, dueDate: new Date() });
    const watch = await Watch.create({ userId: b.user._id, coinId: "bitcoin", symbol: "BTC", condition: { type: "price_above", value: 1 } });
    const headers = { Authorization: `Bearer ${a.token}` };
    expect((await fetch(`${base}/api/debts/${debt._id}`, { headers })).status).toBe(404);
    expect((await fetch(`${base}/api/debts/${debt._id}`, { method: "DELETE", headers })).status).toBe(404);
    expect((await fetch(`${base}/api/watches/${watch._id}`, { method: "DELETE", headers })).status).toBe(404);
    expect(await Debt.exists({ _id: debt._id })).toBeTruthy();
    expect(await Watch.exists({ _id: watch._id })).toBeTruthy();
  });

  it("has no controller that imports a model, and the linter refuses one that does", async () => {
    const dir = path.join(__dirname, "..", "controllers");
    const offenders = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".js"))
      .filter((f) => /require\(["'][^"']*\/models\//.test(fs.readFileSync(path.join(dir, f), "utf8")));
    expect(offenders).toEqual([]);

    const eslint = new ESLint({ cwd: path.join(__dirname, "..", "..") });
    const [result] = await eslint.lintText('const Debt = require("../models/Debt");\nmodule.exports = { Debt };\n', {
      filePath: path.join(dir, "probe.controller.js"),
    });
    expect(result.messages.map((m) => m.ruleId)).toContain("no-restricted-syntax");
  });
});

describe("LW-138 — deleting an account removes everything it owns", () => {
  it("empties every account-owned collection for that account and leaves others alone", async () => {
    const leaving = await anAccount();
    const staying = await anAccount();
    for (const { user } of [leaving, staying]) {
      await Debt.create({ userId: user._id, debtorName: "x", amount: 1, dueDate: new Date() });
      await mongoose.model("ProfitRecord").collection.insertOne({ userId: user._id, mode: "live", status: "pending", createdAt: new Date() });
      await mongoose.model("RampOrder").collection.insertOne({ userId: user._id, providerOrderId: `order-${String(user._id)}`, createdAt: new Date() });
    }
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await deleteAccount({ user: leaving.user }, res);
    expect(res.body).toEqual({ ok: true });
    for (const Model of Object.values(TENANT_MODELS)) {
      expect(await Model.countDocuments({ userId: leaving.user._id })).toBe(0);
    }
    expect(await User.exists({ _id: leaving.user._id })).toBeNull();
    expect(await mongoose.model("ProfitRecord").countDocuments({ userId: staying.user._id })).toBe(1);
    expect(await mongoose.model("RampOrder").countDocuments({ userId: staying.user._id })).toBe(1);
  });
});
