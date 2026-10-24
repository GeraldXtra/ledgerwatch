const solana = require("../services/solana.service");

const A = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SIG = "5fJBk2VDPpQp6UbgvbQy6vmLS18Dd32rpJ8xJ7ERLZmnL5R7yCRQceWCrwQ2Mhpi6YeG2L13qqJxs5F2GcGb7WFW";

let calls;

function network(handler) {
  calls = [];
  vi.stubGlobal("fetch", async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), method: body.method });
    const out = await handler(String(url), body.method, body.params);
    return { ok: out.status ? out.status < 300 : true, status: out.status || 200, json: async () => out.body };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SOLANA_RPC_URL;
});

describe("Solana — reading the chain", () => {
  it("uses a private endpoint first when one is configured, then the public ones", async () => {
    process.env.SOLANA_RPC_URL = "https://private.example/rpc";
    network((url) => (url.includes("private") ? { status: 503, body: null } : { body: { result: { value: { blockhash: "Ap4XEZw5ED5qriMApGzT8MtaGqnLgaVTTudokeRLhdwh", lastValidBlockHeight: 9 } } } }));
    const r = await solana.getBlockhash("mainnet");
    expect(r.ok).toBe(true);
    expect(calls.map((c) => new URL(c.url).host)).toEqual(["private.example", "api.mainnet-beta.solana.com"]);
  });

  it("moves on when an endpoint is rate limiting, and says how to lift the limit when all are", async () => {
    network(() => ({ body: { error: { code: 429, message: "Too many requests for a specific RPC call" } } }));
    const r = await solana.getBlockhash("mainnet");
    expect(r).toMatchObject({ ok: false, kind: "upstream" });
    expect(r.reason).toMatch(/SOLANA_RPC_URL/);
    expect(calls).toHaveLength(2);
  });

  it("adds up every token account a wallet holds for the same token", async () => {
    network((url, method) => {
      if (method === "getBalance") return { body: { result: { value: 5000 } } };
      return {
        body: {
          result: {
            value: [
              { account: { data: { parsed: { info: { mint: USDC, tokenAmount: { amount: "1500000" } } } } } },
              { account: { data: { parsed: { info: { mint: USDC, tokenAmount: { amount: "500000" } } } } } },
            ],
          },
        },
      };
    });
    const r = await solana.getAccount(A, "mainnet");
    expect(r).toMatchObject({ ok: true, lamports: "5000" });
    expect(r.tokens.find((t) => t.symbol === "USDC").amount).toBe("2000000");
    expect(r.tokens.find((t) => t.symbol === "USDT").amount).toBe("0");
  });

  it("reports a token balance as unknown, never zero, when it could not be read", async () => {
    network((url, method) => (method === "getBalance" ? { body: { result: { value: 1 } } } : { body: { error: { code: -32600, message: "nope" } } }));
    const r = await solana.getAccount(A, "mainnet");
    expect(r.tokens.every((t) => t.amount === null && t.error)).toBe(true);
  });

  it("works out what a transaction did to this wallet, leaving out the fee it paid", async () => {
    network((url, method) => {
      if (method === "getSignaturesForAddress") return { body: { result: [{ signature: SIG, blockTime: 10, err: null }] } };
      return {
        body: {
          result: {
            meta: {
              fee: 5000,
              preBalances: [1000000, 0],
              postBalances: [495000, 500000],
              preTokenBalances: [{ mint: USDC, owner: A, uiTokenAmount: { amount: "0" } }],
              postTokenBalances: [{ mint: USDC, owner: A, uiTokenAmount: { amount: "2500000" } }],
            },
            transaction: { message: { accountKeys: [{ pubkey: A }, { pubkey: "x" }] } },
          },
        },
      };
    });
    const r = await solana.getHistory(A, "mainnet");
    expect(r.items[0].changes).toEqual([
      { symbol: "SOL", decimals: 9, delta: "-500000" },
      { symbol: "USDC", decimals: 6, delta: "2500000" },
    ]);
  });

  it("reads whether a transaction landed and whether it succeeded", async () => {
    network(() => ({ body: { result: { value: [{ confirmationStatus: "confirmed", err: { InstructionError: [0, "Custom"] } }] } } }));
    expect(await solana.getStatus(SIG, "mainnet")).toMatchObject({ found: true, confirmation: "confirmed", success: false });
    network(() => ({ body: { result: { value: [null] } } }));
    expect(await solana.getStatus(SIG, "mainnet")).toMatchObject({ found: false });
  });
});

describe("Solana — sending", () => {
  const TX = "A".repeat(200);

  it("returns the signature the network gives back", async () => {
    network(() => ({ body: { result: SIG } }));
    expect(await solana.send(TX, "mainnet")).toMatchObject({ ok: true, signature: SIG });
  });

  it("reports the node's reason when it refuses the transaction", async () => {
    network(() => ({ body: { error: { code: -32002, message: "Transaction simulation failed: Attempt to debit an account but found no record of a prior credit." } } }));
    expect(await solana.send(TX, "mainnet")).toMatchObject({ ok: false, kind: "rejected" });
  });

  it("refuses something that is not a signed transaction without calling the network", async () => {
    network(() => ({ body: {} }));
    expect((await solana.send("not base64!", "mainnet")).kind).toBe("invalid");
    expect(calls).toHaveLength(0);
  });

  it("only knows the tokens it lists, so it cannot be pointed at an unknown mint", async () => {
    network(() => ({ body: {} }));
    expect((await solana.getRecipient(A, "So11111111111111111111111111111111111111112", "mainnet")).kind).toBe("invalid");
  });
});
