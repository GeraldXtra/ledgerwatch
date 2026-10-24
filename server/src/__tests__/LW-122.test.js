const axios = require("axios");
const mongoose = require("mongoose");
const CoinLogo = require("../models/CoinLogo");

const BTC_IMG = "https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png";
const ETH_IMG = "https://coin-images.coingecko.com/coins/images/279/large/ethereum.png";

function marketRow(id, symbol, image) {
  return {
    id,
    symbol,
    name: id,
    image,
    current_price: 100,
    price_change_percentage_24h: 1,
    market_cap: 1,
    total_volume: 1,
    high_24h: 1,
    low_24h: 1,
    sparkline_in_7d: { price: [1, 2] },
  };
}

function refusal() {
  return Object.assign(new Error("Request failed with status code 429"), {
    response: { status: 429, headers: {} },
  });
}

const cgService = require("../services/coingecko.service");

function freshService() {
  cgService._resetForTests();
  return cgService;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LW-122 — coin logos survive a restart and a CoinGecko refusal", () => {
  it("stores every logo CoinGecko returns, and serves it later when CoinGecko refuses", async () => {
    let cg = freshService();
    vi.spyOn(axios, "get").mockResolvedValueOnce({
      data: [marketRow("bitcoin", "btc", BTC_IMG), marketRow("ethereum", "eth", ETH_IMG)],
    });
    const first = await cg.getLogosMap(["bitcoin", "ethereum"]);
    expect(first.logos).toEqual({ bitcoin: BTC_IMG, ethereum: ETH_IMG });
    await vi.waitFor(async () => expect(await CoinLogo.countDocuments({})).toBe(2));

    cg = freshService();
    vi.restoreAllMocks();
    vi.spyOn(axios, "get").mockRejectedValue(refusal());
    const later = await cg.getLogosMap(["bitcoin", "ethereum"]);
    expect(later.logos).toEqual({ bitcoin: BTC_IMG, ethereum: ETH_IMG });
    expect(later.stale).toBe(false);
  });

  it("never stores an image from a host the page cannot load", async () => {
    const cg = freshService();
    vi.spyOn(axios, "get").mockResolvedValueOnce({
      data: [marketRow("evil", "evl", "https://evil.example/logo.png"), marketRow("plain", "pln", "http://coin-images.coingecko.com/x.png")],
    });
    const out = await cg.getLogosMap(["evil", "plain"]);
    expect(out.logos).toEqual({});
    await new Promise((r) => setTimeout(r, 50));
    expect(await CoinLogo.countDocuments({ coinId: { $in: ["evil", "plain"] } })).toBe(0);
  });

  it("keeps a logo first learned from search, but lets market data replace it", async () => {
    await CoinLogo.create({ coinId: "pepe", image: "https://coin-images.coingecko.com/coins/images/29850/thumb/pepe.png" });
    const cg = freshService();
    await cg.rememberLogos([{ id: "pepe", large: "https://coin-images.coingecko.com/coins/images/29850/large/other.png" }], { onlyIfMissing: true });
    expect((await CoinLogo.findOne({ coinId: "pepe" })).image).toMatch(/thumb\/pepe/);
    await cg.rememberLogos([{ id: "pepe", image: "https://coin-images.coingecko.com/coins/images/29850/large/pepe.png" }]);
    expect((await CoinLogo.findOne({ coinId: "pepe" })).image).toMatch(/large\/pepe/);
  });

  it("falls back to a fixed popular list, with stored logos, when the top coins cannot be fetched", async () => {
    await CoinLogo.create({ coinId: "bitcoin", image: BTC_IMG });
    const cg = freshService();
    vi.spyOn(axios, "get").mockRejectedValue(refusal());
    const top = await cg.getTopCoins(30);
    expect(top.fallback).toBe(true);
    expect(top.coins).toHaveLength(30);
    expect(top.coins[0]).toMatchObject({ id: "bitcoin", symbol: "BTC", image: BTC_IMG });
    expect(top.coins.every((c) => c.symbol && c.name)).toBe(true);
  });

  it("serves the live top coins when CoinGecko answers", async () => {
    const cg = freshService();
    vi.spyOn(axios, "get").mockResolvedValueOnce({
      data: Array.from({ length: 40 }, (_, i) => marketRow(`coin-${i}`, `c${i}`, `https://coin-images.coingecko.com/coins/images/${i}/large/c.png`)),
    });
    const top = await cg.getTopCoins(25);
    expect(top.fallback).toBeUndefined();
    expect(top.coins).toHaveLength(25);
    expect(top.coins[24]).toMatchObject({ id: "coin-24", symbol: "C24" });
  });
});

describe("LW-123 — more than 250 coins are fetched in chunks, never cut off", () => {
  it("splits a large request into pages of 250 and asks for every row", async () => {
    const cg = freshService();
    const ids = Array.from({ length: 300 }, (_, i) => `coin-${i}`);
    const spy = vi.spyOn(axios, "get").mockImplementation(async (url, { params }) => ({
      data: params.ids.split(",").map((id) => marketRow(id, id, null)),
    }));
    const { markets } = await cg.getMarketsMap(ids);
    expect(Object.keys(markets)).toHaveLength(300);
    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) {
      expect(call[1].params.per_page).toBe(250);
      expect(call[1].params.ids.split(",").length).toBeLessThanOrEqual(250);
    }
  });
});

describe("LW-122 — the markets answer carries a logo even for a coin with no market data", () => {
  it("returns stored logos for coins CoinGecko did not answer for", async () => {
    await CoinLogo.create({ coinId: "bitcoin", image: BTC_IMG });
    freshService();
    vi.spyOn(axios, "get").mockRejectedValue(refusal());
    const markets = require("../controllers/markets.controller");
    const res = { statusCode: 200, body: null, status(c) { res.statusCode = c; return res; }, json(b) { res.body = b; return res; } };
    await markets.get({ query: { ids: "bitcoin" }, user: { _id: new mongoose.Types.ObjectId(), tradingMode: "paper" } }, res);
    expect(res.body.markets).toEqual([]);
    expect(res.body.logos).toEqual({ bitcoin: BTC_IMG });
  });

  it("keeps the logo on a new watch", async () => {
    freshService();
    vi.spyOn(axios, "get").mockResolvedValue({ data: [marketRow("bitcoin", "btc", BTC_IMG)] });
    const { createWatch } = require("../services/market.service");
    const watch = await createWatch(new mongoose.Types.ObjectId(), { coinId: "bitcoin", symbol: "BTC", type: "price_above", value: 1 });
    expect(watch.image).toBe(BTC_IMG);
  });
});
