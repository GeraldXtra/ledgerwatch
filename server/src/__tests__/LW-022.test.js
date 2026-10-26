const mongoose = require("mongoose");
const WalletTx = require("../models/WalletTx");
const wallet = require("../controllers/wallet.controller");

const CHAIN_ID = 84532;
const FROM = "0x1111111111111111111111111111111111111111";
const ROUTER = "0x2222222222222222222222222222222222222222";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const TOKEN = "0x4200000000000000000000000000000000000006";

let seq = 0;
const nextHash = () => `0x${(++seq).toString(16).padStart(64, "0")}`;

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
  };
  return res;
}

function aUser(tradingLimits = {}) {
  return { _id: new mongoose.Types.ObjectId(), tradingLimits };
}

async function record(user, fields) {
  const res = mockRes();
  await wallet.recordTx(
    {
      user,
      body: {
        chainId: CHAIN_ID,
        hash: nextHash(),
        from: FROM,
        to: ROUTER,
        symbol: "USDC",
        tokenAddress: USDC,
        direction: "out",
        kind: "swap",
        side: "buy",
        tokenOut: TOKEN,
        tokenOutSymbol: "WETH",
        amountOut: "0.01",
        ...fields,
      },
    },
    res
  );
  return res;
}

describe("LW-022 — the server enforces the live trading caps before a swap is recorded", () => {
  it("records a swap inside the limits", async () => {
    const user = aUser({ perTrade: 50, perDay: 100 });
    const res = await record(user, { value: "40" });
    expect(res.statusCode).toBe(201);
    expect(await WalletTx.countDocuments({ userId: user._id })).toBe(1);
  });

  it("refuses a swap above the limit for one trade, and records nothing", async () => {
    const user = aUser({ perTrade: 50, perDay: 100 });
    const res = await record(user, { value: "60" });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("trade_limit");
    expect(res.body.error).toMatch(/above your \$50 limit for one live trade/);
    expect(await WalletTx.countDocuments({ userId: user._id })).toBe(0);
  });

  it("refuses the swap that would cross the daily limit, and says what is left", async () => {
    const user = aUser({ perTrade: 50, perDay: 100 });
    expect((await record(user, { value: "45" })).statusCode).toBe(201);
    expect((await record(user, { value: "45" })).statusCode).toBe(201);
    const res = await record(user, { value: "20" });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("daily_limit");
    expect(res.body.error).toMatch(/\$10\.00 is left today/);
  });

  it("counts sales by the dollars they return", async () => {
    const user = aUser({ perTrade: 60, perDay: 100 });
    expect((await record(user, { side: "sell", symbol: "WETH", tokenAddress: TOKEN, value: "0.01", tokenOutSymbol: "USDC", tokenOut: USDC, amountOut: "49" })).statusCode).toBe(201);
    expect((await record(user, { value: "51" })).statusCode).toBe(201);
    const res = await record(user, { value: "1" });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("daily_limit");
  });

  it("does not count a swap that failed", async () => {
    const user = aUser({ perTrade: 100, perDay: 100 });
    const first = await record(user, { value: "90" });
    await WalletTx.updateOne({ _id: first.body.tx._id }, { status: "failed" });
    expect((await record(user, { value: "90" })).statusCode).toBe(201);
  });

  it("refuses a swap it cannot value in dollars", async () => {
    const user = aUser();
    const res = await record(user, { side: null, symbol: "ZZZ", tokenOutSymbol: "YYY", value: "1", amountOut: "0.03" });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("unpriced_swap");
  });

  it("returns the existing record for a hash already saved, even once the limit is reached", async () => {
    const user = aUser({ perTrade: 100, perDay: 100 });
    const hash = nextHash();
    const first = await record(user, { hash, value: "100" });
    expect(first.statusCode).toBe(201);
    const again = await record(user, { hash, value: "100" });
    expect(again.statusCode).toBe(200);
    expect(String(again.body.tx._id)).toBe(String(first.body.tx._id));
  });

  it("leaves plain transfers alone", async () => {
    const user = aUser({ perTrade: 1, perDay: 1 });
    const res = await record(user, { kind: "transfer", side: null, value: "500", tokenOut: null, tokenOutSymbol: null, amountOut: null });
    expect(res.statusCode).toBe(201);
  });

  it("uses the testnet defaults when the account sets nothing", async () => {
    const user = aUser();
    expect((await record(user, { value: "1000" })).statusCode).toBe(201);
    const res = await record(user, { value: "1001" });
    expect(res.body.code).toBe("trade_limit");
  });
});
