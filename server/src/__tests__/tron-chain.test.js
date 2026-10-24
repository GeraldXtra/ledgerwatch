const tron = require("../services/tron.service");

const A = "TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs";
const B = "TNaRAoLUyYEV2uF7GUrzSjRQTU8v5ZJ5VR";
const TXID = "d52e4780b4ed4fba143bd94c0e0f32e1ee14c003c2af4c144d7e3619affe4577";
const SIGNED = "0a" + "11".repeat(80);

let calls;

function answer(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
}

function network(handler) {
  calls = [];
  vi.stubGlobal("fetch", async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null, headers: init.headers || {} });
    return handler(String(url), init);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TRONGRID_API_KEY;
});

describe("Tron — reading the chain", () => {
  it("encodes a Tron address as the 20 bytes a contract call expects", () => {
    expect(tron.hexOf(A)).toBe("4166426c7ac3d98b29191063833345b6bc540d7278");
    expect(tron.addressParam(A)).toBe("00000000000000000000000066426c7ac3d98b29191063833345b6bc540d7278");
  });

  it("refuses an address or network it does not know", () => {
    expect(tron.validateAddress("0x1111111111111111111111111111111111111111", "mainnet").ok).toBe(false);
    expect(tron.validateNetwork("shasta").ok).toBe(false);
  });

  it("falls back to another full node when TronGrid is limiting this server", async () => {
    network((url) =>
      url.includes("trongrid.io")
        ? answer(429, "slow down")
        : answer(200, { blockID: "00".repeat(32), block_header: { raw_data: { number: 5, timestamp: 9 } } })
    );
    const r = await tron.getBlock("mainnet");
    expect(r.ok).toBe(true);
    expect(calls.map((c) => new URL(c.url).host)).toEqual(["api.trongrid.io", "tron-rpc.publicnode.com"]);
  });

  it("sends the API key only to TronGrid", async () => {
    process.env.TRONGRID_API_KEY = "0123456789abcdef0123456789abcdef";
    network((url) => (url.includes("trongrid.io") ? answer(429, "") : answer(200, { blockID: "00".repeat(32), block_header: { raw_data: { number: 5, timestamp: 9 } } })));
    await tron.getBlock("mainnet");
    expect(calls[0].headers["TRON-PRO-API-KEY"]).toBe(process.env.TRONGRID_API_KEY);
    expect(calls[1].headers["TRON-PRO-API-KEY"]).toBeUndefined();
  });

  it("reads a transaction's outcome, including one not yet on chain", async () => {
    network(() => answer(200, { id: TXID, blockNumber: 7, receipt: { result: "OUT_OF_ENERGY" }, fee: 1200 }));
    expect(await tron.getTxInfo(TXID, "mainnet")).toMatchObject({ found: true, success: false, result: "OUT_OF_ENERGY", feeSun: "1200" });
    network(() => answer(200, {}));
    expect(await tron.getTxInfo(TXID, "mainnet")).toMatchObject({ found: false });
  });

  it("prices a token transfer from simulated energy, with a margin and a ceiling", async () => {
    network((url) => {
      if (url.includes("triggerconstantcontract")) return answer(200, { result: { result: true }, constant_result: [""], energy_used: 65000 });
      return answer(200, { chainParameter: [{ key: "getEnergyFee", value: 210 }] });
    });
    const r = await tron.estimateTokenTransfer({ owner: A, to: B, amount: "1000000", network: "testnet" });
    expect(r).toMatchObject({ ok: true, energy: 78000, feeLimit: 16380000 });
  });

  it("merges TRX and USDT history, newest first", async () => {
    network((url) => {
      if (url.includes("/trc20")) {
        return answer(200, { data: [{ transaction_id: "b".repeat(64), token_info: { symbol: "USDT", decimals: 6 }, from: B, to: A, value: "2500000", block_timestamp: 20 }] });
      }
      return answer(200, {
        data: [
          {
            txID: "a".repeat(64),
            block_timestamp: 10,
            ret: [{ contractRet: "SUCCESS" }],
            raw_data: { contract: [{ type: "TransferContract", parameter: { value: { amount: 1000000, owner_address: tron.hexOf(A), to_address: tron.hexOf(B) } } }] },
          },
        ],
      });
    });
    const r = await tron.getHistory(A, "mainnet");
    expect(r.items.map((i) => [i.symbol, i.direction, i.amount])).toEqual([
      ["USDT", "in", "2500000"],
      ["TRX", "out", "1000000"],
    ]);
  });
});

describe("Tron — broadcasting never risks paying twice", () => {
  it("returns the transaction id when the network accepts it", async () => {
    network(() => answer(200, { result: true, txid: TXID }));
    expect(await tron.broadcastHex(SIGNED, "mainnet")).toMatchObject({ ok: true, txid: TXID });
  });

  it("tries another node only when the first refused before reading the transaction", async () => {
    network((url) => (url.includes("trongrid.io") ? answer(429, "") : answer(200, { result: true, txid: TXID })));
    expect(await tron.broadcastHex(SIGNED, "mainnet")).toMatchObject({ ok: true, txid: TXID });
    expect(calls).toHaveLength(2);
  });

  it("stops and reports an ambiguous result when a node fails mid-broadcast", async () => {
    network((url) => (url.includes("trongrid.io") ? answer(502, "bad gateway") : answer(200, { result: true, txid: TXID })));
    const r = await tron.broadcastHex(SIGNED, "mainnet");
    expect(r.kind).toBe("ambiguous");
    expect(calls).toHaveLength(1);
  });

  it("reports the network's own reason when it refuses a transaction", async () => {
    network(() => answer(200, { result: false, code: "CONTRACT_VALIDATE_ERROR", message: Buffer.from("balance is not sufficient").toString("hex") }));
    expect(await tron.broadcastHex(SIGNED, "mainnet")).toMatchObject({ ok: false, kind: "rejected", reason: "balance is not sufficient" });
  });

  it("treats a duplicate as already sent, not as a failure to retry", async () => {
    network(() => answer(200, { result: false, code: "DUP_TRANSACTION_ERROR", txid: TXID }));
    expect(await tron.broadcastHex(SIGNED, "mainnet")).toMatchObject({ ok: true, duplicate: true });
  });

  it("refuses something that is not a signed transaction without calling the network", async () => {
    network(() => answer(200, {}));
    expect((await tron.broadcastHex("zz", "mainnet")).kind).toBe("invalid");
    expect(calls).toHaveLength(0);
  });
});

describe("Tron — the API key belongs to mainnet", () => {
  it("never sends the mainnet key to the Nile testnet", async () => {
    process.env.TRONGRID_API_KEY = "0123456789abcdef0123456789abcdef";
    network(() => answer(200, { blockID: "00".repeat(32), block_header: { raw_data: { number: 5, timestamp: 9 } } }));
    await tron.getBlock("testnet");
    expect(calls[0].url).toContain("nile.trongrid.io");
    expect(calls[0].headers["TRON-PRO-API-KEY"]).toBeUndefined();
  });
});
