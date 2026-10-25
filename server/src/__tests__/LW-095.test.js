const axios = require("axios");
const cg = require("../services/coingecko.service");

function marketsRow(id) {
  return { id, symbol: id.slice(0, 3), name: id, current_price: 1, image: null };
}

function fakeUpstream() {
  const calls = [];
  vi.spyOn(axios, "get").mockImplementation(async (url, opts = {}) => {
    calls.push(url);
    if (url.endsWith("/coins/markets")) {
      const ids = String((opts.params && opts.params.ids) || "").split(",").filter(Boolean);
      return { data: ids.map(marketsRow) };
    }
    if (url.includes("/coins/")) return { data: { id: url.split("/coins/")[1], detail_platforms: {} } };
    if (url.endsWith("/search")) return { data: { coins: [] } };
    return { data: {} };
  });
  return calls;
}

const ENV_KEYS = ["COINGECKO_API_KEY", "COINGECKO_PLAN"];
let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  cg._resetForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
  cg._resetForTests();
});

describe("LW-095 — one account's coin lookups cannot take prices dark for everyone", () => {
  it("stops coin lookups at their own share without calling upstream, and prices still load", async () => {
    const calls = fakeUpstream();
    for (const id of ["alpha", "bravo", "charlie", "delta", "echo"]) {
      await cg.getCoinPlatforms(id);
    }
    const lookups = calls.filter((u) => u.includes("/coins/") && !u.endsWith("/coins/markets"));
    expect(lookups).toHaveLength(3);

    const prices = await cg.getPrices(["bitcoin"]);
    expect(prices.bitcoin && prices.bitcoin.usd).toBe(1);
    expect(calls.filter((u) => u.endsWith("/coins/markets"))).toHaveLength(1);

    const status = cg.cgStatus();
    expect(status.pausedForMs).toBe(0);
    expect(status.budget).toMatchObject({ total: 8, lookups: 3, lookupsUsed: 3, used: 4 });
  });

  it("never sends more calls in a minute than the allowance, whatever the mix", async () => {
    const calls = fakeUpstream();
    for (let i = 0; i < 12; i++) await cg.getPrices([`coin-${i}`]);
    expect(calls).toHaveLength(8);
    expect(cg.cgStatus().pausedForMs).toBe(0);
  });

  it("gives a keyed account a larger allowance", async () => {
    process.env.COINGECKO_API_KEY = "CG-demo-key-for-tests";
    const calls = fakeUpstream();
    for (let i = 0; i < 12; i++) await cg.getCoinPlatforms(`token-${i}`);
    expect(calls).toHaveLength(10);
    expect(cg.cgStatus().budget).toMatchObject({ total: 25, lookups: 10 });
  });
});
