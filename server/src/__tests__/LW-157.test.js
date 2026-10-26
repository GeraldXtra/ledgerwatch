process.env.JWT_SECRET = process.env.JWT_SECRET || "lw-display-currency-tests-0123456789abcdef";
process.env.SMTP_HOST = "";
process.env.VAPID_PRIVATE_KEY = "";
process.env.ANTHROPIC_API_KEY = "";

const axios = require("axios");
const app = require("../app");
const User = require("../models/User");
const signToken = require("../utils/token");
const publicUser = require("../utils/publicUser");
const cg = require("../services/coingecko.service");
const { DISPLAY_CURRENCIES } = require("../utils/displayCurrency");

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

beforeEach(() => {
  cg._resetForTests();
  vi.restoreAllMocks();
});

async function signedIn() {
  const user = await User.create({
    name: "Currency",
    email: `currency-${Date.now()}-${++seq}@example.com`,
    passwordHash: "x",
    emailVerified: true,
  });
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

const EXCHANGE_RATES = {
  rates: {
    btc: { name: "Bitcoin", unit: "BTC", value: 1, type: "crypto" },
    usd: { name: "US Dollar", unit: "$", value: 80000, type: "fiat" },
    ngn: { name: "Nigerian Naira", unit: "₦", value: 80000 * 1600, type: "fiat" },
    eur: { name: "Euro", unit: "€", value: 80000 * 0.9, type: "fiat" },
    gbp: { name: "Pound", unit: "£", value: 80000 * 0.8, type: "fiat" },
    eth: { name: "Ether", unit: "ETH", value: 30, type: "crypto" },
  },
};

describe("LW-157 — the display currency is an account setting that follows the user", () => {
  it("defaults to USD for an account that never chose one", async () => {
    const { user } = await signedIn();
    expect(publicUser(user).displayCurrency).toBe("USD");
    expect(publicUser({ ...user.toObject(), displayCurrency: "nonsense" }).displayCurrency).toBe("USD");
  });

  it("saves a supported currency through PATCH /api/auth/me and returns it on every read", async () => {
    const { token } = await signedIn();
    const saved = await call("PATCH", "/api/auth/me", { token, body: { displayCurrency: "NGN" } });
    expect(saved.status).toBe(200);
    expect(saved.body.user.displayCurrency).toBe("NGN");
    const me = await call("GET", "/api/auth/me", { token });
    expect(me.body.user.displayCurrency).toBe("NGN");
  });

  it("accepts every currency on the offered list", async () => {
    const { token } = await signedIn();
    for (const code of DISPLAY_CURRENCIES) {
      const res = await call("PATCH", "/api/auth/me", { token, body: { displayCurrency: code } });
      expect(res.status).toBe(200);
      expect(res.body.user.displayCurrency).toBe(code);
    }
  });

  it("refuses a currency that is not offered, a lower-case code and a wrong type, naming the field", async () => {
    const { user, token } = await signedIn();
    for (const bad of ["XYZ", "ngn", "", 12, null, "GHS"]) {
      const res = await call("PATCH", "/api/auth/me", { token, body: { displayCurrency: bad } });
      expect(res.status).toBe(400);
      expect(res.body.field).toBe("displayCurrency");
    }
    const row = await User.findById(user._id).lean();
    expect(row.displayCurrency).toBe("USD");
  });

  it("does not let the model store an unlisted code even if a caller skips the schema", async () => {
    const { user } = await signedIn();
    await expect(User.updateOne({ _id: user._id }, { $set: { displayCurrency: "XYZ" } }, { runValidators: true })).rejects.toThrow();
  });
});

describe("LW-157 — USD to fiat rates come through the CoinGecko transport and never throw", () => {
  it("converts the BTC based table into USD based rates for the offered currencies", async () => {
    const urls = [];
    vi.spyOn(axios, "get").mockImplementation(async (url) => {
      urls.push(url);
      return { data: EXCHANGE_RATES };
    });
    const { token } = await signedIn();
    const res = await call("GET", "/api/prices/fiat", { token });
    expect(res.status).toBe(200);
    expect(res.body.base).toBe("USD");
    expect(res.body.available).toBe(true);
    expect(res.body.stale).toBe(false);
    expect(res.body.rates.USD).toBe(1);
    expect(res.body.rates.NGN).toBeCloseTo(1600, 6);
    expect(res.body.rates.EUR).toBeCloseTo(0.9, 9);
    expect(res.body.rates.ETH).toBeUndefined();
    expect(res.body.missing).toContain("JPY");
    expect(urls.filter((u) => u.endsWith("/exchange_rates"))).toHaveLength(1);

    await call("GET", "/api/prices/fiat", { token });
    expect(urls.filter((u) => u.endsWith("/exchange_rates"))).toHaveLength(1);
  });

  it("answers with USD only and says so when the upstream fails", async () => {
    vi.spyOn(axios, "get").mockRejectedValue(Object.assign(new Error("down"), { response: { status: 503, headers: {} } }));
    const { token } = await signedIn();
    const res = await call("GET", "/api/prices/fiat", { token });
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.stale).toBe(true);
    expect(res.body.rates).toEqual({ USD: 1 });
    const direct = await cg.getFiatRates();
    expect(direct).toMatchObject({ available: false, rates: { USD: 1 } });
  });

  it("keeps serving the last good table, flagged stale, when a refresh fails", async () => {
    const spy = vi.spyOn(axios, "get").mockResolvedValue({ data: EXCHANGE_RATES });
    expect((await cg.getFiatRates()).available).toBe(true);
    spy.mockRejectedValue(new Error("down"));
    const realNow = Date.now;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 24 * 60 * 60 * 1000);
    const later = await cg.getFiatRates();
    expect(later.available).toBe(true);
    expect(later.stale).toBe(true);
    expect(later.rates.NGN).toBeCloseTo(1600, 6);
  });

  it("refuses an unsigned request", async () => {
    const res = await call("GET", "/api/prices/fiat");
    expect(res.status).toBe(401);
  });
});
