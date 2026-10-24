const ton = require("../services/ton.service");

const OWN = "0:DB84D7D46BD998A0F79AA46ECBFD87F6F1273AE2CA34FCDA12CD7A0FC3B79C68";
const OWN_FRIENDLY = "UQDbhNfUa9mYoPeapG7L_Yf28Sc64so0_NoSzXoPw7ecaDOe";
const OTHER = "0:157AE7D159AA499DBE715629414F1B082410820EDDFB56E6D76BE7989D726461";
const USDT = "0:B113A994B5024A16719F69139328EB759596C38A25F59028B146FECDC3621DFE";

let calls;

function network(handler) {
  calls = [];
  vi.stubGlobal("fetch", async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    const out = await handler(String(url));
    return { ok: (out.status || 200) < 300, status: out.status || 200, json: async () => out.body };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TON addresses", () => {
  it("turns a friendly address into its raw form, checking the checksum", () => {
    expect(ton.rawOf("EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs")).toBe(USDT);
    expect(ton.rawOf("EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDt")).toBeNull();
    expect(ton.rawOf(OWN.toLowerCase())).toBe(OWN);
  });

  it("refuses something that is not a TON address", () => {
    expect(ton.validateAddress("0x1111111111111111111111111111111111111111", "mainnet").ok).toBe(false);
  });
});

describe("TON — reading accounts", () => {
  it("reads balance, deployment and sequence number, with the USDT balance beside it", async () => {
    network((url) => {
      if (url.includes("getWalletInformation")) return { body: { ok: true, result: { balance: "9699948332", account_state: "active", seqno: 3, wallet_type: "wallet v4 r2" } } };
      return { body: { jetton_wallets: [{ address: "0:AA", jetton: USDT, balance: "2500000" }] } };
    });
    const r = await ton.getAccount(OWN_FRIENDLY, "mainnet");
    expect(r).toMatchObject({ ok: true, nanotons: "9699948332", deployed: true, seqno: 3 });
    expect(r.tokens[0]).toMatchObject({ symbol: "USDT", amount: "2500000", jettonWallet: "0:AA" });
  });

  it("refuses an address holding a wallet type it does not sign for", async () => {
    network(() => ({ body: { ok: true, result: { account_state: "active", seqno: 1, wallet_type: "wallet v3 r2" } } }));
    expect((await ton.getAccount(OWN, "mainnet")).reason).toMatch(/v3 r2/);
  });

  it("refuses a token wallet that does not belong to USDT", async () => {
    network((url) => {
      if (url.includes("getWalletInformation")) return { body: { ok: true, result: { account_state: "active", seqno: 1, wallet_type: "wallet v4 r2" } } };
      return { body: { jetton_wallets: [{ address: "0:BB", jetton: OTHER, balance: "1" }] } };
    });
    const r = await ton.getAccount(OWN, "mainnet");
    expect(r.tokens[0].amount).toBeNull();
    expect(r.tokens[0].error).toMatch(/does not belong to USDT/);
  });

  it("retries once when the keyless limit refuses a request", async () => {
    let n = 0;
    network(() => (++n === 1 ? { status: 429, body: { ok: false } } : { body: { ok: true, result: "active" } }));
    expect(await ton.getRecipient(OWN, "mainnet")).toMatchObject({ ok: true, active: true });
    expect(calls).toHaveLength(2);
  }, 10000);

  it("labels each USDT transfer by whether this wallet sent or received it", async () => {
    network((url) => {
      if (url.includes("getTransactions")) return { body: { ok: true, result: [] } };
      return {
        body: {
          jetton_transfers: [
            { source: OTHER, destination: OWN, amount: "1000000", transaction_hash: "a", transaction_now: 20 },
            { source: OWN, destination: OTHER, amount: "400000", transaction_hash: "b", transaction_now: 10, transaction_aborted: true },
          ],
        },
      };
    });
    const r = await ton.getHistory(OWN_FRIENDLY, "mainnet");
    expect(r.items.map((i) => [i.delta, i.success])).toEqual([
      ["1000000", true],
      ["-400000", false],
    ]);
  });
});

describe("TON — sending", () => {
  it("returns the message hash when the network takes the message", async () => {
    network(() => ({ body: { ok: true, result: { hash: "abc=" } } }));
    expect(await ton.send("A".repeat(200), "mainnet")).toMatchObject({ ok: true, hash: "abc=" });
  });

  it("reports a message the network refuses as refused", async () => {
    network(() => ({ status: 500, body: { ok: false, error: "INVALID_BAG_OF_CELLS: cannot deserialize" } }));
    expect(await ton.send("A".repeat(200), "mainnet")).toMatchObject({ ok: false, kind: "rejected" });
  });

  it("refuses something that is not a signed message without calling the network", async () => {
    network(() => ({ body: {} }));
    expect((await ton.send("short", "mainnet")).kind).toBe("invalid");
    expect(calls).toHaveLength(0);
  });
});

describe("TON — each network has its own key", () => {
  afterEach(() => {
    delete process.env.TONCENTER_API_KEY;
    delete process.env.TONCENTER_TESTNET_API_KEY;
  });

  function headersFor() {
    const seen = [];
    vi.stubGlobal("fetch", async (url, init = {}) => {
      seen.push({ url: String(url), key: init.headers && init.headers["X-API-Key"] });
      return { ok: true, status: 200, json: async () => ({ ok: true, result: "active" }) };
    });
    return seen;
  }

  it("sends the mainnet key to mainnet and the testnet key to testnet, never one to the other", async () => {
    process.env.TONCENTER_API_KEY = "a".repeat(64);
    process.env.TONCENTER_TESTNET_API_KEY = "b".repeat(64);
    const seen = headersFor();
    await ton.getRecipient(OWN, "mainnet");
    await ton.getRecipient(OWN, "testnet");
    expect(seen[0]).toMatchObject({ url: expect.stringContaining("//toncenter.com"), key: "a".repeat(64) });
    expect(seen[1]).toMatchObject({ url: expect.stringContaining("testnet.toncenter.com"), key: "b".repeat(64) });
  });

  it("sends no key to testnet when only the mainnet key is set", async () => {
    process.env.TONCENTER_API_KEY = "a".repeat(64);
    const seen = headersFor();
    await ton.getRecipient(OWN, "testnet");
    expect(seen[0].key).toBeUndefined();
  }, 10000);
});
