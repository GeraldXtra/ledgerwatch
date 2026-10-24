process.env.JWT_SECRET = process.env.JWT_SECRET || "lw-security-tests-only-0123456789abcdef";

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const security = require("../middleware/security");
const requireAuth = require("../middleware/auth");
const { login, register } = require("../controllers/auth.controller");
const signToken = require("../utils/token");

let seq = 0;
const anEmail = () => `sec-${Date.now()}-${++seq}@example.com`;

function mockRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  res.setHeader = (k, v) => {
    res.headers[k.toLowerCase()] = v;
  };
  return res;
}

function filter(req) {
  const res = mockRes();
  let passed = false;
  security.rejectUnsafeInput({ method: "POST", path: "/api/x", ip: "203.0.113.9", params: {}, query: {}, body: {}, ...req }, res, () => {
    passed = true;
  });
  return { passed, res };
}

beforeEach(() => {
  security._resetForTests();
});

describe("LW-128 — query operators and reserved keys never reach a database filter", () => {
  it("refuses a query operator smuggled through the query string", () => {
    const query = security.parseQuery("paymentId[$gt]=000000000000000000000000");
    const { passed, res } = filter({ query });
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("unsafe_input");
  });

  it("refuses an operator in a JSON body, at any depth", () => {
    expect(filter({ body: { email: { $ne: null }, password: "x" } }).passed).toBe(false);
    expect(filter({ body: { a: [{ b: { $where: "1" } }] } }).passed).toBe(false);
  });

  it("refuses prototype keys and dotted paths", () => {
    expect(filter({ body: JSON.parse('{"__proto__": {"admin": true}}') }).passed).toBe(false);
    expect(filter({ body: { constructor: { prototype: {} } } }).passed).toBe(false);
    expect(filter({ body: { "crypto.enabled": false } }).passed).toBe(false);
  });

  it("refuses absurdly deep or wide input", () => {
    let deep = {};
    const root = deep;
    for (let i = 0; i < 20; i++) deep = deep.next = {};
    expect(filter({ body: root }).passed).toBe(false);
    const wide = Object.fromEntries(Array.from({ length: 2500 }, (_, i) => [`k${i}`, i]));
    expect(filter({ body: wide }).passed).toBe(false);
  });

  it("lets ordinary requests through untouched, including JSON-RPC calls with addresses as keys", () => {
    const body = {
      method: "eth_simulateV1",
      params: [{ blockStateCalls: [{ stateOverrides: { "0x1111111111111111111111111111111111111111": { balance: "0x1" } } }] }, "latest"],
    };
    expect(filter({ body, query: security.parseQuery("ids=bitcoin,ethereum&limit=30") }).passed).toBe(true);
    expect(body.method).toBe("eth_simulateV1");
  });

  it("drops prototype keys while parsing a query string", () => {
    const q = security.parseQuery("__proto__[polluted]=yes&ok=1");
    expect(q).toEqual({ ok: "1" });
    expect({}.polluted).toBeUndefined();
  });
});

describe("security headers on every API answer", () => {
  it("forbids framing, sniffing, caching and any active content", () => {
    const res = mockRes();
    security.securityHeaders({ path: "/api/auth/me" }, res, () => {});
    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    );
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });
});

describe("LW-129 — an account cannot be guessed at from many networks at once", () => {
  async function anAccount(password) {
    return User.create({
      name: "Locked",
      email: anEmail(),
      passwordHash: await bcrypt.hash(password, 4),
      emailVerified: true,
      emailVerification: { lastSentAt: new Date() },
    });
  }

  async function attempt(email, password, ip) {
    const res = mockRes();
    await login({ body: { email, password }, ip }, res);
    return res;
  }

  it("locks the account after ten wrong passwords, whatever network they came from", async () => {
    const user = await anAccount("correct horse battery");
    for (let i = 0; i < security.MAX_FAILURES; i++) {
      expect((await attempt(user.email, `wrong-${i}`, `198.51.100.${i}`)).statusCode).toBe(401);
    }
    const locked = await attempt(user.email, "correct horse battery", "192.0.2.1");
    expect(locked.statusCode).toBe(429);
    expect(locked.body.code).toBe("account_locked");
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("locks an address that has no account the same way, so the lock reveals nothing", async () => {
    const email = anEmail();
    for (let i = 0; i < security.MAX_FAILURES; i++) await attempt(email, "nope", "198.51.100.1");
    expect((await attempt(email, "nope", "198.51.100.1")).body.code).toBe("account_locked");
  });

  it("clears the count on a successful sign in", async () => {
    const user = await anAccount("correct horse battery");
    for (let i = 0; i < security.MAX_FAILURES - 1; i++) await attempt(user.email, "wrong", "198.51.100.1");
    expect((await attempt(user.email, "correct horse battery", "198.51.100.1")).statusCode).toBe(200);
    expect((await attempt(user.email, "wrong", "198.51.100.1")).statusCode).toBe(401);
    expect((await attempt(user.email, "correct horse battery", "198.51.100.1")).statusCode).toBe(200);
  });

  it("upgrades an old, cheaper password hash when its owner signs in", async () => {
    const user = await anAccount("correct horse battery");
    expect(bcrypt.getRounds(user.passwordHash)).toBe(4);
    expect((await attempt(user.email, "correct horse battery", "198.51.100.1")).statusCode).toBe(200);
    const after = await User.findById(user._id).lean();
    expect(bcrypt.getRounds(after.passwordHash)).toBe(12);
    expect(await bcrypt.compare("correct horse battery", after.passwordHash)).toBe(true);
  });
});

describe("LW-130 — sign up accepts only well-formed text", () => {
  async function signUp(body) {
    const res = mockRes();
    await register({ body, ip: "198.51.100.1" }, res);
    return res;
  }

  it("refuses fields that are not text", async () => {
    expect((await signUp({ name: { $gt: "" }, email: anEmail(), password: "a sound passphrase" })).statusCode).toBe(400);
    expect((await signUp({ name: "A", email: [anEmail()], password: "a sound passphrase" })).statusCode).toBe(400);
    expect((await signUp({ name: "A", email: anEmail(), password: 12345678901 })).statusCode).toBe(400);
  });

  it("refuses the most common passwords and one built from the email address", async () => {
    expect((await signUp({ name: "A", email: anEmail(), password: "password123" })).body.error).toMatch(/commonly used/);
    expect((await signUp({ name: "A", email: "chidinma.okafor@example.com", password: "chidinma.okafor2026" })).body.error).toMatch(/email/);
    expect((await signUp({ name: "A", email: anEmail(), password: "aaaaaaaaaa" })).body.error).toMatch(/repeated/);
  });

  it("keeps only the three bank fields, as text", async () => {
    const email = anEmail();
    const res = await signUp({
      name: "Ada",
      email,
      password: "a sound passphrase",
      bankDetails: { bankName: "GTB", accountNumber: "0123456789", accountName: { evil: 1 }, role: "admin" },
    });
    expect(res.statusCode).toBeLessThan(300);
    const stored = await User.findOne({ email }).lean();
    expect(stored.bankDetails).toMatchObject({ bankName: "GTB", accountNumber: "0123456789" });
    expect(stored.bankDetails.role).toBeUndefined();
    expect(typeof (stored.bankDetails.accountName || "")).toBe("string");
  });
});

describe("sessions accept only the algorithm they were issued with", () => {
  async function authWith(token) {
    const res = mockRes();
    let passed = false;
    await requireAuth({ headers: { authorization: `Bearer ${token}` } }, res, () => {
      passed = true;
    });
    return { passed, res };
  }

  it("accepts a normal session token", async () => {
    const user = await User.create({ name: "S", email: anEmail(), passwordHash: "x" });
    expect((await authWith(signToken(user._id, 0))).passed).toBe(true);
  });

  it("refuses a token signed with another algorithm, or with none", async () => {
    const user = await User.create({ name: "S", email: anEmail(), passwordHash: "x" });
    const other = jwt.sign({ id: String(user._id), v: 0 }, process.env.JWT_SECRET, { algorithm: "HS512" });
    expect((await authWith(other)).res.statusCode).toBe(401);
    const none = jwt.sign({ id: String(user._id), v: 0 }, null, { algorithm: "none" });
    expect((await authWith(none)).res.statusCode).toBe(401);
  });

  it("refuses a notification action token used as a session", async () => {
    const { signActionToken } = require("../services/push.service");
    const action = signActionToken("507f1f77bcf86cd799439011", "dismiss_alert", "x");
    expect((await authWith(action)).res.statusCode).toBe(401);
  });
});

describe("password rules", () => {
  it("accepts a reasonable passphrase and refuses the obvious ones", () => {
    expect(security.passwordProblem("a sound passphrase", { email: "ada@example.com" })).toBeNull();
    expect(security.passwordProblem("short")).toMatch(/at least 8/);
    expect(security.passwordProblem("x".repeat(300))).toMatch(/256/);
    expect(security.passwordProblem("LedgerWatch123")).toMatch(/commonly used/);
  });
});
