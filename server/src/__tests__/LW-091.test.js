const mongoose = require("mongoose");
const rpcService = require("../services/rpc.service");
const realSendToChain = rpcService.sendToChain;
const realRpcCallTyped = rpcService.rpcCallTyped;

const WalletTx = require("../models/WalletTx");
const wallet = require("../controllers/wallet.controller");

const CHAIN_ID = 84532;
const HASH = `0x${"ab".repeat(32)}`;
const FROM = "0x1111111111111111111111111111111111111111";
const ROUTER = "0x2222222222222222222222222222222222222222";

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
    set() {
      return res;
    },
    send(body) {
      res.body = body;
      return res;
    },
  };
  return res;
}

describe("LW-091 — sendToChain says whether a failed broadcast may have reached the network", () => {
  const chain = { chainId: 999001, name: "Test chain", rpcs: ["https://a.invalid/rpc", "https://b.invalid/rpc"] };
  const broadcastBody = { jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: ["0x02"] };
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("marks a broadcast that timed out as ambiguous and does not try a second endpoint", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    globalThis.fetch = vi.fn().mockRejectedValue(timeout);
    const out = await rpcService.sendToChain(chain, broadcastBody);
    expect(out.ok).toBe(false);
    expect(out.ambiguous).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("marks a broadcast every endpoint refused before accepting as not ambiguous", async () => {
    const refused = Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(refused)
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "slow down" });
    const out = await rpcService.sendToChain(chain, broadcastBody);
    expect(out.ok).toBe(false);
    expect(out.ambiguous).toBe(false);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("reports a served broadcast as not ambiguous", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result: HASH }),
    });
    const out = await rpcService.sendToChain(chain, broadcastBody);
    expect(out.ok).toBe(true);
    expect(out.ambiguous).toBe(false);
  });
});

describe("LW-091 — the RPC proxy tells the browser which kind of broadcast failure it was", () => {
  const sendToChain = vi.fn();

  beforeAll(() => {
    rpcService.sendToChain = sendToChain;
  });
  afterAll(() => {
    rpcService.sendToChain = realSendToChain;
  });
  beforeEach(() => {
    sendToChain.mockReset();
  });

  const failed = (ambiguous) => ({
    ok: false,
    total: 2,
    ambiguous,
    attempts: [{ host: "a.invalid", reason: "ETIMEDOUT", code: "ETIMEDOUT" }],
  });
  const call = async (method) => {
    const res = mockRes();
    await wallet.rpc(
      { params: { chainId: String(CHAIN_ID) }, body: { jsonrpc: "2.0", id: 1, method, params: ["0x02"] } },
      res
    );
    return res;
  };

  it("says unknown when the broadcast may already be in the mempool", async () => {
    sendToChain.mockResolvedValue(failed(true));
    const res = await call("eth_sendRawTransaction");
    expect(res.statusCode).toBe(502);
    expect(res.body.broadcast).toBe("unknown");
  });

  it("says not_sent when no endpoint accepted the broadcast", async () => {
    sendToChain.mockResolvedValue(failed(false));
    const res = await call("eth_sendRawTransaction");
    expect(res.statusCode).toBe(502);
    expect(res.body.broadcast).toBe("not_sent");
  });

  it("adds nothing to a failed read", async () => {
    sendToChain.mockResolvedValue(failed(false));
    const res = await call("eth_blockNumber");
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toHaveProperty("broadcast");
  });

  it("allows eth_simulateV1, a read, through the proxy", async () => {
    sendToChain.mockResolvedValue({ ok: true, status: 200, text: '{"jsonrpc":"2.0","id":1,"result":[]}' });
    const res = await call("eth_simulateV1");
    expect(res.statusCode).toBe(200);
    expect(sendToChain).toHaveBeenCalledTimes(1);
  });
});

describe("LW-091 — a swap the network never received can be recorded as failed, and only that", () => {
  const rpcCallTyped = vi.fn();
  const userId = new mongoose.Types.ObjectId();

  beforeAll(() => {
    rpcService.rpcCallTyped = rpcCallTyped;
  });
  afterAll(() => {
    rpcService.rpcCallTyped = realRpcCallTyped;
  });
  beforeEach(() => {
    rpcCallTyped.mockReset();
  });

  const aPendingSwap = () =>
    WalletTx.create({
      userId,
      chainId: CHAIN_ID,
      hash: HASH,
      from: FROM,
      to: ROUTER,
      value: "25",
      symbol: "USDC",
      kind: "swap",
      side: "buy",
      status: "pending",
    });

  const chainSays = ({ receipt, byHash }) => {
    rpcCallTyped.mockImplementation(async (chain, method) => {
      if (method === "eth_getTransactionReceipt") return receipt;
      if (method === "eth_getTransactionByHash") return byHash;
      throw new Error(`unexpected ${method}`);
    });
  };

  const markFailed = async (tx) => {
    const res = mockRes();
    await wallet.updateTxStatus({ params: { id: String(tx._id) }, body: { status: "failed" }, user: { _id: userId } }, res);
    return res;
  };

  it("records it as failed when the chain has neither a receipt nor the transaction", async () => {
    const tx = await aPendingSwap();
    chainSays({ receipt: { ok: true, result: null }, byHash: { ok: true, result: null } });
    const res = await markFailed(tx);
    expect(res.statusCode).toBe(200);
    expect(res.body.notOnChain).toBe(true);
    expect((await WalletTx.findById(tx._id)).status).toBe("failed");
  });

  it("refuses while the transaction is still waiting to be mined", async () => {
    const tx = await aPendingSwap();
    chainSays({ receipt: { ok: true, result: null }, byHash: { ok: true, result: { hash: HASH, blockNumber: null } } });
    const res = await markFailed(tx);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("not_mined");
    expect((await WalletTx.findById(tx._id)).status).toBe("pending");
  });

  it("changes nothing when the transaction lookup itself fails", async () => {
    const tx = await aPendingSwap();
    chainSays({ receipt: { ok: true, result: null }, byHash: { ok: false, reason: "all 2 endpoint(s) failed" } });
    const res = await markFailed(tx);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe("unverified");
    expect((await WalletTx.findById(tx._id)).status).toBe("pending");
  });

  it("changes nothing when the receipt lookup fails", async () => {
    const tx = await aPendingSwap();
    chainSays({ receipt: { ok: false, reason: "all 2 endpoint(s) failed" }, byHash: { ok: true, result: null } });
    const res = await markFailed(tx);
    expect(res.statusCode).toBe(503);
    expect((await WalletTx.findById(tx._id)).status).toBe("pending");
  });

  it("records a mined, reverted swap as failed", async () => {
    const tx = await aPendingSwap();
    chainSays({ receipt: { ok: true, result: { status: "0x0" } }, byHash: { ok: true, result: null } });
    const res = await markFailed(tx);
    expect(res.statusCode).toBe(200);
    expect((await WalletTx.findById(tx._id)).status).toBe("failed");
  });

  it("records a swap that succeeded as confirmed instead", async () => {
    const tx = await aPendingSwap();
    chainSays({ receipt: { ok: true, result: { status: "0x1" } }, byHash: { ok: true, result: null } });
    const res = await markFailed(tx);
    expect(res.statusCode).toBe(409);
    expect((await WalletTx.findById(tx._id)).status).toBe("confirmed");
  });
});
