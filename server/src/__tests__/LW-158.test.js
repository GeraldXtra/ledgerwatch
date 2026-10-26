process.env.JWT_SECRET = process.env.JWT_SECRET || "lw-158-wallet-swaps-tests-0123456789abcdef";
process.env.SMTP_HOST = "";
process.env.VAPID_PRIVATE_KEY = "";
process.env.ANTHROPIC_API_KEY = "";

const axios = require("axios");
const app = require("../app");
const User = require("../models/User");
const WalletTx = require("../models/WalletTx");
const signToken = require("../utils/token");
const cg = require("../services/coingecko.service");

const CHAIN_ID = 84532;
const FROM = "0x1111111111111111111111111111111111111111";
const ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4";
const WETH = "0x4200000000000000000000000000000000000006";
const LINK = "0xE4aB69C077896252FAFBD49EFD26B5D171A32410";

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
  vi.spyOn(axios, "get").mockImplementation(async (url, config) => {
    if (String(url).endsWith("/coins/markets")) {
      const ids = String((config && config.params && config.params.ids) || "").split(",");
      const rows = [];
      if (ids.includes("ethereum")) rows.push({ id: "ethereum", symbol: "eth", name: "Ethereum", current_price: 3000, image: "" });
      if (ids.includes("chainlink")) rows.push({ id: "chainlink", symbol: "link", name: "Chainlink", current_price: 15, image: "" });
      return { data: rows };
    }
    return { data: {} };
  });
});

async function signedIn() {
  const user = await User.create({ name: "Swapper", email: `lw158-${Date.now()}-${++seq}@example.com`, passwordHash: "x", emailVerified: true });
  return { user, token: signToken(user._id, user.tokenVersion) };
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const hash = () => `0x${String(++seq).padStart(64, "a")}`;

function swap(overrides = {}) {
  return {
    chainId: CHAIN_ID,
    hash: hash(),
    from: FROM,
    to: ROUTER,
    value: "0.01",
    symbol: "WETH",
    tokenAddress: WETH,
    direction: "out",
    kind: "swap",
    tokenOut: LINK,
    tokenOutSymbol: "LINK",
    amountOut: "2",
    minAmountOut: "1.98",
    feeTier: 3000,
    route: "WETH > LINK (3000)",
    priceImpactPct: 0.1,
    side: null,
    ...overrides,
  };
}

describe("LW-158 — a wallet swap between two non-stablecoins is still held to the trading caps", () => {
  it("values the swap from the coin paid with a live price, records that value and counts it in the day's spend", async () => {
    const { token } = await signedIn();
    const res = await call("POST", "/api/wallet/txs", { token, body: swap() });
    expect(res.status).toBe(201);
    expect(res.body.tx).toMatchObject({ kind: "swap", side: null, cashValue: 30, route: "WETH > LINK (3000)" });

    const spend = await call("GET", "/api/wallet/spend", { token });
    expect(spend.body).toMatchObject({ spent24h: 30, swaps: 1, unpricedSwaps: 0, complete: true });
  });

  it("values it from the coin received when the one paid has no price", async () => {
    const { token } = await signedIn();
    const res = await call("POST", "/api/wallet/txs", { token, body: swap({ symbol: "ZZZ", tokenAddress: LINK, value: "5", tokenOutSymbol: "LINK", amountOut: "2" }) });
    expect(res.status).toBe(201);
    expect(res.body.tx.cashValue).toBe(30);
  });

  it("refuses a swap it cannot value at all, before anything is sent", async () => {
    const { token } = await signedIn();
    const res = await call("POST", "/api/wallet/txs", { token, body: swap({ symbol: "ZZZ", tokenOutSymbol: "YYY" }) });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("unpriced_swap");
    expect(await WalletTx.countDocuments({})).toBe(0);
  });

  it("refuses a native coin swap above the per-trade cap, priced by the server not the browser", async () => {
    const { token } = await signedIn();
    const res = await call("POST", "/api/wallet/txs", { token, body: swap({ value: "1", symbol: "ETH", tokenAddress: null }) });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("trade_limit");
    expect(res.body.error).toMatch(/\$3000\.00/);
  });

  it("a stablecoin on either side is the value, whichever way the swap goes and with no side given", async () => {
    const { token } = await signedIn();
    const a = await call("POST", "/api/wallet/txs", { token, body: swap({ symbol: "USDC", value: "40", tokenOutSymbol: "LINK", amountOut: "2.6" }) });
    expect(a.body.tx.cashValue).toBe(40);
    const b = await call("POST", "/api/wallet/txs", { token, body: swap({ symbol: "LINK", value: "2", tokenOutSymbol: "USDT", amountOut: "29.5" }) });
    expect(b.body.tx.cashValue).toBe(29.5);
    const spend = await call("GET", "/api/wallet/spend", { token });
    expect(spend.body.spent24h).toBe(69.5);
  });
});
