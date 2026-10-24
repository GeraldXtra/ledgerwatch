const utxo = require("../services/utxo.service");
const bitcoin = require("../services/bitcoin.service");

const LTC = "ltc1qjmxnz78nmc8nq77wuxh25n2es7rzm5c2rkk4wh";
const DOGE = "DBus3bamQjgJULBJtYXpEzDWQRwF5iwxgC";
const TXID = "1b51a116ba75cc0dd9e13b86bd570629427a5d7d009d80706f4ba16137f5eee8";
const RAW = "0100000001" + "ab".repeat(60);

let calls;

function answer(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
}

function network(routes) {
  calls = [];
  vi.stubGlobal("fetch", async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body, type: init.headers && init.headers["Content-Type"] });
    for (const [match, reply] of routes) {
      if (String(url).includes(match)) return typeof reply === "function" ? reply(url, init) : reply;
    }
    return answer(404, "not routed");
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UTXO coins — one service for Bitcoin, Litecoin and Dogecoin", () => {
  it("still answers Bitcoin exactly as before", () => {
    expect(bitcoin.NETWORKS).toEqual(["mainnet", "testnet"]);
    expect(bitcoin.validateAddress("xyz", "mainnet").reason).toBe(
      "That is not a valid mainnet Bitcoin address. A mainnet address starts with bc1, 1 or 3."
    );
    expect(bitcoin.validateAddress("BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ", "mainnet").address).toBe(
      "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"
    );
  });

  it("validates each coin's own addresses and networks", () => {
    expect(utxo.validateAddress(LTC, "mainnet", "litecoin").ok).toBe(true);
    expect(utxo.validateAddress(DOGE, "mainnet", "dogecoin").ok).toBe(true);
    expect(utxo.validateAddress(DOGE, "mainnet", "litecoin").ok).toBe(false);
    expect(utxo.validateAddress(LTC, "mainnet", "bitcoin").ok).toBe(false);
    expect(utxo.validateNetwork("testnet", "dogecoin").reason).toBe("Dogecoin is available on mainnet only.");
    expect(utxo.validateCoin("monero").ok).toBe(false);
  });

  it("never lowercases a case-sensitive base58 address", () => {
    const legacy = "Ltc1" + "x".repeat(29);
    const r = utxo.validateAddress(legacy, "mainnet", "litecoin");
    expect(r.ok ? r.address : legacy).toBe(legacy);
  });

  it("reads a Litecoin balance from the mempool-style service", async () => {
    network([["litecoinspace.org/api/address/", answer(200, { chain_stats: { funded_txo_sum: 5000, spent_txo_sum: 1000, tx_count: 2 }, mempool_stats: { funded_txo_sum: 300, spent_txo_sum: 0, tx_count: 1 } })]]);
    const r = await utxo.getBalance(LTC, "mainnet", "litecoin");
    expect(r).toMatchObject({ ok: true, coin: "litecoin", confirmed: 4000, pending: 300, total: 4300, txCount: 3 });
  });

  it("reads Dogecoin from BlockCypher and its unspent outputs with confirmations", async () => {
    network([
      ["/addrs/" + DOGE + "/balance", answer(200, { balance: 700, unconfirmed_balance: 50, final_n_tx: 4 })],
      ["unspentOnly=true", answer(200, { txrefs: [{ tx_hash: TXID, tx_output_n: 1, value: 700, confirmations: 3, block_height: 10 }], unconfirmed_txrefs: [{ tx_hash: TXID, tx_output_n: 2, value: 50, confirmations: 0 }], hasMore: false })],
    ]);
    expect(await utxo.getBalance(DOGE, "mainnet", "dogecoin")).toMatchObject({ ok: true, confirmed: 700, pending: 50, total: 750 });
    const u = await utxo.getUtxos(DOGE, "mainnet", "dogecoin");
    expect(u).toMatchObject({ ok: true, total: 750, truncated: false });
    expect(u.utxos).toEqual([
      { txid: TXID, vout: 1, value: 700, confirmed: true, blockHeight: 10 },
      { txid: TXID, vout: 2, value: 50, confirmed: false, blockHeight: null },
    ]);
  });

  it("turns BlockCypher's per-kilobyte estimates into per-byte rates, never below the relay floor", async () => {
    network([["blockcypher.com/v1/doge/main", answer(200, { high_fee_per_kb: 2254326, medium_fee_per_kb: 5670290, low_fee_per_kb: 900 })]]);
    const r = await utxo.getFeeRates("mainnet", "dogecoin");
    expect(r).toMatchObject({ ok: true, unit: "koinu/byte", fast: 2255, medium: 5671, slow: 1000 });
  });

  it("falls back to Blockchair when BlockCypher is rate limited, and treats its 430 block the same way", async () => {
    network([
      ["blockcypher.com", answer(429, "slow down")],
      ["blockchair.com/dogecoin/raw/transaction/", answer(200, { data: { [TXID]: { raw_transaction: RAW } } })],
    ]);
    const r = await utxo.getRawTx(TXID, "mainnet", "dogecoin");
    expect(r).toMatchObject({ ok: true, hex: RAW });

    network([["blockcypher.com", answer(430, "blocked")], ["blockchair.com", answer(430, "blocked")]]);
    const both = await utxo.getRawTx(TXID, "mainnet", "dogecoin");
    expect(both).toMatchObject({ ok: false, kind: "upstream" });
    expect(calls).toHaveLength(2);
  });

  it("broadcasts Dogecoin to BlockCypher as JSON and reads the hash back", async () => {
    network([["/txs/push", answer(201, { tx: { hash: TXID } })]]);
    const r = await utxo.broadcast(RAW, "mainnet", "dogecoin");
    expect(r).toMatchObject({ ok: true, txid: TXID, coin: "dogecoin" });
    expect(calls[0]).toMatchObject({ method: "POST", type: "application/json" });
    expect(JSON.parse(calls[0].body)).toEqual({ tx: RAW });
  });

  it("never sends a broadcast to a second provider after an ambiguous failure", async () => {
    network([["/txs/push", answer(502, "bad gateway")], ["/push/transaction", answer(200, { data: { transaction_hash: TXID } })]]);
    const r = await utxo.broadcast(RAW, "mainnet", "dogecoin");
    expect(r.kind).toBe("ambiguous");
    expect(calls).toHaveLength(1);
  });

  it("does try the second provider when the first refused before reading the transaction", async () => {
    network([["/txs/push", answer(429, "slow down")], ["/push/transaction", answer(200, { data: { transaction_hash: TXID } })]]);
    const r = await utxo.broadcast(RAW, "mainnet", "dogecoin");
    expect(r).toMatchObject({ ok: true, txid: TXID });
    expect(calls[1].body).toBe(`data=${RAW}`);
  });

  it("reports a rejected transaction as rejected, not as a network fault", async () => {
    network([["/txs/push", answer(400, "Error validating transaction: insufficient priority")]]);
    const r = await utxo.broadcast(RAW, "mainnet", "dogecoin");
    expect(r).toMatchObject({ ok: false, kind: "rejected" });
    expect(r.reason).toMatch(/insufficient priority/);
  });

  it("works out each transaction's effect on the address from BlockCypher's inputs and outputs", async () => {
    network([[
      "/full?",
      answer(200, {
        txs: [
          {
            hash: TXID,
            confirmations: 2,
            block_height: 9,
            confirmed: "2026-10-20T15:35:34Z",
            fees: 226000,
            inputs: [{ addresses: [DOGE], output_value: 1000000 }],
            outputs: [{ addresses: ["DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L"], value: 600000 }, { addresses: [DOGE], value: 174000 }],
          },
        ],
      }),
    ]]);
    const r = await utxo.getTxs(DOGE, "mainnet", "dogecoin");
    expect(r.txs[0]).toMatchObject({ txid: TXID, valueDelta: -826000, direction: "out", fee: 226000, confirmed: true });
  });

  it("refuses a malformed transaction id from a provider rather than signing against it", async () => {
    network([["unspentOnly=true", answer(200, { txrefs: [{ tx_hash: "nope", tx_output_n: 0, value: 1, confirmations: 1 }] })]]);
    const r = await utxo.getUtxos(DOGE, "mainnet", "dogecoin");
    expect(r).toMatchObject({ ok: false, kind: "unparseable" });
  });
});
