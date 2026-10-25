process.env.JWT_SECRET = process.env.JWT_SECRET || "lw-validation-tests-only-0123456789abcdefgh";
process.env.SMTP_HOST = "";
process.env.VAPID_PRIVATE_KEY = "";
process.env.ANTHROPIC_API_KEY = "";

const mongoose = require("mongoose");
const app = require("../app");
const User = require("../models/User");
const Debt = require("../models/Debt");
const signToken = require("../utils/token");

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

async function signedIn() {
  const user = await User.create({ name: "Shape", email: `shape-${Date.now()}-${++seq}@example.com`, passwordHash: "x", emailVerified: true });
  return { user, token: signToken(user._id, user.tokenVersion) };
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

function routesOf(stack, prefix = "") {
  const out = [];
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        out.push({ path: `${prefix}${layer.route.path}`, method, handlers: layer.route.stack.map((s) => s.handle) });
      }
    } else if (layer.handle && layer.handle.stack) {
      const mount = layer.regexp && layer.regexp.source
        .replace("^\\", "")
        .replace("\\/?(?=\\/|$)", "")
        .replace(/\\\//g, "/");
      out.push(...routesOf(layer.handle.stack, `${prefix}/${mount || ""}`.replace(/\/+/g, "/")));
    }
  }
  return out;
}

describe("LW-136 — every route checks the shape of what it is sent", () => {
  it("declares a schema on every route, with no gaps", () => {
    const routes = routesOf(app._router.stack);
    expect(routes.length).toBeGreaterThan(120);
    const gaps = routes.filter((r) => !r.handlers.some((h) => h && h.isValidator)).map((r) => `${r.method.toUpperCase()} ${r.path}`);
    expect(gaps).toEqual([]);
  });

  it("refuses operator keys in the query at the edge", async () => {
    const { token } = await signedIn();
    const res = await fetch(`${base}/api/debts?debtId[$ne]=null`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(400);
  });

  it("refuses an array where a single value is expected", async () => {
    const { token } = await signedIn();
    const res = await fetch(`${base}/api/debts?status[]=paid`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("status");
  });

  it("answers 400, not 500, for dates that are not dates", async () => {
    const { token } = await signedIn();
    expect((await call("GET", "/api/debts?from=yesterday-ish", { token })).status).toBe(400);
    const debt = await call("POST", "/api/debts", { token, body: { debtorName: "Date", amount: 500, dueDate: "2030-01-01" } });
    expect(debt.status).toBe(201);
    const pay = await call("POST", `/api/debts/${debt.body.debt._id}/payments`, {
      token,
      body: { amount: 100, paidAt: "the other day", idempotencyKey: "abcdefgh1234" },
    });
    expect(pay.status).toBe(400);
    expect(pay.body.field).toBe("paidAt");
  });

  it("caps the length of free text", async () => {
    const { token } = await signedIn();
    expect((await call("GET", `/api/debts?search=${"a".repeat(201)}`, { token })).status).toBe(400);
    const chat = await call("POST", "/api/ai/chat", { token, body: { message: "x".repeat(2001) } });
    expect(chat.status).toBe(400);
    expect(chat.body.error).toMatch(/at most 2000 characters/);
    const note = await call("POST", "/api/debts", { token, body: { debtorName: "Note", amount: 5, dueDate: "2030-01-01", note: "n".repeat(2001) } });
    expect(note.status).toBe(400);
  });

  it("refuses a malformed id with 400 instead of looking it up", async () => {
    const { token } = await signedIn();
    const res = await call("GET", "/api/debts/not-an-id", { token });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a valid id/);
  });

  it("drops keys a route does not know, so they cannot reach the database", async () => {
    const { user, token } = await signedIn();
    const other = new mongoose.Types.ObjectId();
    const res = await call("POST", "/api/debts", {
      token,
      body: { debtorName: "Strip", amount: 750.25, dueDate: "2030-01-01", userId: String(other), status: "paid", amountKobo: 1 },
    });
    expect(res.status).toBe(201);
    const stored = await Debt.findById(res.body.debt._id).lean();
    expect(String(stored.userId)).toBe(String(user._id));
    expect(stored.status).toBe("pending");
    expect(stored.amountKobo).toBe(75025);
  });

  it("still carries every field the real screens send", async () => {
    const { token } = await signedIn();
    const created = await call("POST", "/api/debts", {
      token,
      body: { debtorName: "Flow", debtorPhone: "08031234567", debtorEmail: "flow@example.com", amount: 1000, dueDate: "2030-01-01", note: "n", reminderCadenceDays: 2 },
    });
    expect(created.status).toBe(201);
    const id = created.body.debt._id;
    const listed = await call("GET", "/api/debts?status=pending&search=Flow&from=2029-01-01&to=2031-01-01", { token });
    expect(listed.body.debts.map((d) => d._id)).toContain(id);
    const paid = await call("POST", `/api/debts/${id}/payments`, {
      token,
      body: { amount: 400.5, method: "cash", note: "first", paidAt: "2030-01-01", idempotencyKey: "flow-key-0001" },
    });
    expect(paid.status).toBe(201);
    expect(paid.body.debt).toMatchObject({ amountPaid: 400.5, balance: 599.5 });
    const settings = await call("PATCH", "/api/auth/me", {
      token,
      body: { notifyPrefs: { marketAlerts: false, unknownKey: true }, crypto: { expiryHours: "48", confirmationOverrides: { 84532: 7 } } },
    });
    expect(settings.status).toBe(200);
    expect(settings.body.user.notifyPrefs.marketAlerts).toBe(false);
    expect(settings.body.user.crypto.expiryHours).toBe(48);
    const marked = await call("PATCH", `/api/debts/${id}/paid`, { token });
    expect(marked.body.debt).toMatchObject({ balance: 0, displayStatus: "paid" });
  });

  it("keeps the RPC proxy's own limits on batches and methods", async () => {
    const { token } = await signedIn();
    const call1 = { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] };
    const big = await call("POST", "/api/wallet/rpc/84532", { token, body: Array.from({ length: 25 }, () => call1) });
    expect(big.status).toBe(400);
    const signing = await call("POST", "/api/wallet/rpc/84532", { token, body: { ...call1, method: "eth_sendTransaction" } });
    expect(signing.status).toBe(403);
  });
});
