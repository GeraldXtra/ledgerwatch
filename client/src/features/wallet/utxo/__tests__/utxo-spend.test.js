import { describe, it, expect } from "vitest";
import * as btc from "@scure/btc-signer";
import * as bip39 from "@scure/bip39";
import { HDKey } from "@scure/bip32";
import {
  DOGECOIN_PARAMS,
  LITECOIN_PARAMS,
  deriveUtxoAccount,
  deriveUtxoPrivateKey,
  formatUnits,
  parseUnits,
} from "../coins";
import { buildUtxoSpend, planUtxoSpend, validateUtxoDestination } from "../spend";

const VECTOR = [...Array(11).fill("abandon"), "about"].join(" ");
const OTHER_LTC = btc.p2wpkh(
  HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(VECTOR)).derive("m/84'/2'/0'/0/1").publicKey,
  LITECOIN_PARAMS
).address;

function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function previousTx(script, amount, extraOutputs = []) {
  const raw = btc.RawTx.encode({
    version: 1,
    segwitFlag: false,
    inputs: [{ txid: new Uint8Array(32).fill(7), index: 0, finalScriptSig: new Uint8Array(0), sequence: 0xffffffff }],
    outputs: [...extraOutputs, { amount: BigInt(amount), script }],
    witnesses: [],
    lockTime: 0,
  });
  return { hex: hex(raw), txid: btc.Transaction.fromRaw(raw, { allowUnknownOutputs: true }).id, vout: extraOutputs.length };
}

describe("Litecoin and Dogecoin come from the same recovery phrase as the rest of the wallet", () => {
  it("derives the published test vector addresses", () => {
    expect(deriveUtxoAccount(VECTOR, "litecoin", "mainnet").address).toBe("ltc1qjmxnz78nmc8nq77wuxh25n2es7rzm5c2rkk4wh");
    expect(deriveUtxoAccount(VECTOR, "litecoin", "testnet").address).toBe("tltc1q6rz28mcfaxtmd6v789l9rrlrusdprr9pesrjxk");
    expect(deriveUtxoAccount(VECTOR, "dogecoin", "mainnet").address).toBe("DBus3bamQjgJULBJtYXpEzDWQRwF5iwxgC");
  });

  it("refuses a wallet without a recovery phrase, and networks a coin does not have", () => {
    expect(() => deriveUtxoAccount("", "litecoin", "mainnet")).toThrow(/no recovery phrase/);
    expect(() => deriveUtxoAccount(VECTOR, "dogecoin", "testnet")).toThrow(/not available on testnet/);
  });

  it("reads and writes amounts exactly, without floating point", () => {
    expect(parseUnits("0.1", 8)).toBe(10000000);
    expect(parseUnits("12.345678912", 8)).toBeNull();
    expect(parseUnits("12.34567891", 8)).toBe(1234567891);
    expect(parseUnits("1e5", 8)).toBeNull();
    expect(formatUnits(123456789, 8)).toBe("1.23456789");
    expect(formatUnits(100000000, 8)).toBe("1");
  });
});

describe("addresses are checked against the right coin", () => {
  it("accepts a Litecoin address on Litecoin and refuses a Bitcoin one", () => {
    expect(validateUtxoDestination(OTHER_LTC, "litecoin", "mainnet").ok).toBe(true);
    expect(validateUtxoDestination("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "litecoin", "mainnet").ok).toBe(false);
  });

  it("accepts a Dogecoin address on Dogecoin and refuses a Litecoin one", () => {
    expect(validateUtxoDestination("DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L", "dogecoin", "mainnet").ok).toBe(true);
    expect(validateUtxoDestination(OTHER_LTC, "dogecoin", "mainnet").reason).toMatch(/not a Dogecoin address/);
  });
});

describe("Litecoin spends", () => {
  const from = deriveUtxoAccount(VECTOR, "litecoin", "mainnet").address;
  const key = deriveUtxoPrivateKey(VECTOR, "litecoin", "mainnet");
  const utxos = [{ txid: "ab".repeat(32), vout: 1, value: 2000000, confirmed: true }];

  it("plans a payment with change and refuses one below dust", () => {
    const plan = planUtxoSpend({ coin: "litecoin", network: "mainnet", utxos, fromAddress: from, toAddress: OTHER_LTC, amount: 1000000, feeRate: 2 });
    expect(plan).toMatchObject({ ok: true, hasChange: true, amount: 1000000 });
    expect(plan.inputTotal).toBe(plan.amount + plan.fee + plan.change);
    expect(planUtxoSpend({ coin: "litecoin", network: "mainnet", utxos, fromAddress: from, toAddress: OTHER_LTC, amount: 100, feeRate: 2 }).reason).toMatch(/below the smallest payment/);
  });

  it("signs exactly what was planned", () => {
    const args = { coin: "litecoin", network: "mainnet", utxos, fromAddress: from, toAddress: OTHER_LTC, amount: 1000000, feeRate: 2 };
    const plan = planUtxoSpend(args);
    const built = buildUtxoSpend({ ...args, privateKey: key });
    expect(built.ok).toBe(true);
    expect(built.fee).toBe(plan.fee);
    const tx = btc.Transaction.fromRaw(Uint8Array.from(built.hex.match(/../g).map((h) => parseInt(h, 16))));
    expect(tx.id).toBe(built.txid);
    expect(btc.Address(LITECOIN_PARAMS).encode(btc.OutScript.decode(tx.getOutput(0).script))).toBe(OTHER_LTC);
    expect(tx.getOutput(0).amount).toBe(1000000n);
    expect(btc.Address(LITECOIN_PARAMS).encode(btc.OutScript.decode(tx.getOutput(1).script))).toBe(from);
    expect(tx.getInput(0).sequence).toBe(0xfffffffd);
  });

  it("sends a change amount below dust to the fee instead of making an unspendable output", () => {
    const plan = planUtxoSpend({ coin: "litecoin", network: "mainnet", utxos, fromAddress: from, toAddress: OTHER_LTC, amount: 2000000 - 1000, feeRate: 1 });
    expect(plan).toMatchObject({ ok: true, hasChange: false, change: 0, fee: 1000 });
  });
});

describe("Dogecoin spends sign only what the chain itself says the coins are", () => {
  const from = deriveUtxoAccount(VECTOR, "dogecoin", "mainnet").address;
  const key = deriveUtxoPrivateKey(VECTOR, "dogecoin", "mainnet");
  const ownScript = btc.OutScript.encode(btc.Address(DOGECOIN_PARAMS).decode(from));
  const prev = previousTx(ownScript, 500000000, [{ amount: 1n, script: ownScript }]);
  const to = "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L";
  const base = {
    coin: "dogecoin",
    network: "mainnet",
    utxos: [{ txid: prev.txid, vout: prev.vout, value: 500000000, confirmed: true }],
    fromAddress: from,
    toAddress: to,
    amount: 100000000,
    feeRate: 10000,
  };

  it("builds a signed legacy payment with the full previous transaction", () => {
    const built = buildUtxoSpend({ ...base, privateKey: key, rawTxs: { [prev.txid]: prev.hex } });
    expect(built.ok).toBe(true);
    const tx = btc.Transaction.fromRaw(Uint8Array.from(built.hex.match(/../g).map((h) => parseInt(h, 16))));
    expect(btc.Address(DOGECOIN_PARAMS).encode(btc.OutScript.decode(tx.getOutput(0).script))).toBe(to);
    expect(tx.getOutput(0).amount).toBe(100000000n);
    expect(tx.getInput(0).finalScriptSig.length).toBeGreaterThan(100);
    expect(tx.getInput(0).sequence).toBe(0xffffffff);
    expect(built.size).toBe(built.hex.length / 2);
  });

  it("refuses when the data service returns a different previous transaction", () => {
    const other = previousTx(ownScript, 500000000);
    expect(buildUtxoSpend({ ...base, privateKey: key, rawTxs: { [prev.txid]: other.hex } }).reason).toMatch(/wrong previous transaction/);
  });

  it("refuses when the claimed amount is not what the chain recorded", () => {
    const lying = { ...base, utxos: [{ ...base.utxos[0], value: 400000000 }] };
    expect(buildUtxoSpend({ ...lying, privateKey: key, rawTxs: { [prev.txid]: prev.hex } }).reason).toMatch(/not what the data service described/);
  });

  it("refuses to sign a coin it cannot read", () => {
    expect(buildUtxoSpend({ ...base, privateKey: key, rawTxs: {} }).reason).toMatch(/could not be read/);
  });

  it("refuses a fee larger than the payment", () => {
    const silly = { ...base, amount: 1000000, feeRate: 100000 };
    expect(buildUtxoSpend({ ...silly, privateKey: key, rawTxs: { [prev.txid]: prev.hex } }).reason).toMatch(/fee .* would be larger/);
  });

  it("will not go below the Dogecoin relay floor or the 0.01 DOGE dust limit", () => {
    expect(planUtxoSpend({ ...base, feeRate: 10 }).reason).toMatch(/at least 1000 koinu per byte/);
    expect(planUtxoSpend({ ...base, amount: 999999 }).reason).toMatch(/below the smallest payment/);
  });
});
