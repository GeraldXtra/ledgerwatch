import { describe, it, expect, beforeEach } from "vitest";
import * as btc from "@scure/btc-signer";

import {
  BITCOIN_PATHS,
  MAINNET_ACCOUNT_PATH,
  TESTNET_ACCOUNT_PATH,
  canDeriveBitcoin,
  deriveBitcoinAccount,
  deriveBitcoinPrivateKey,
} from "../derivation.js";

import {
  DUST_LIMIT_SATS,
  RBF_SEQUENCE,
  buildP2wpkhSpend,
  estimateFee,
  estimateVsize,
  planCancel,
  planP2wpkhSpend,
  selectUtxos,
  validateDestination,
} from "../tx.js";

import {
  cacheBitcoinAddress,
  clearBitcoinAddressCache,
  isPlausibleBitcoinAddress,
  readCachedBitcoinAddress,
} from "../addressCache.js";

/**
 * TEST VECTORS ONLY. Never a phrase anybody has used.
 *
 * This repository has an open incident (LW-001) caused by real mnemonics reaching
 * git, so the rule here is absolute: the only phrase in this file is the published
 * BIP 39 all zeros vector, which is in every specification document and every test
 * suite on the internet and controls nothing.
 */
const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

/**
 * The published BIP 84 test vector for the first receive address of the first
 * account, derived from the phrase above at m/84'/0'/0'/0/0.
 *
 * IF AN IMPLEMENTATION DISAGREES WITH THIS STRING, THE IMPLEMENTATION IS WRONG.
 * It is not a value to be updated to match code. Every BIP 84 wallet in existence
 * produces it, and a wallet that produces anything else is one whose funds no
 * other wallet can ever recover from the same phrase.
 */
const BIP84_FIRST_MAINNET_ADDRESS = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";

/** Helper: hex string to bytes, so a built transaction can be decoded and checked. */
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function decode(hex) {
  return btc.Transaction.fromRaw(hexToBytes(hex));
}

/** A P2WPKH output script is 22 bytes: OP_0 push20 <hash>. */
const P2WPKH_SCRIPT_LEN = 22;

describe("BIP 84 derivation", () => {
  it("derives the published BIP 84 first mainnet address from the standard test vector", () => {
    const account = deriveBitcoinAccount(TEST_MNEMONIC, "mainnet");
    expect(account.address).toBe(BIP84_FIRST_MAINNET_ADDRESS);
    expect(account.path).toBe("m/84'/0'/0'/0/0");
  });

  it("puts testnet on a different coin type, so it derives a different address", () => {
    const mainnet = deriveBitcoinAccount(TEST_MNEMONIC, "mainnet");
    const testnet = deriveBitcoinAccount(TEST_MNEMONIC, "testnet");

    // The whole point of SLIP 44 coin type 1: one phrase, two independent
    // accounts. If these ever matched, a testnet key would control real coins.
    expect(testnet.address).not.toBe(mainnet.address);
    expect(testnet.path).toBe("m/84'/1'/0'/0/0");
    expect(mainnet.address.startsWith("bc1q")).toBe(true);
    expect(testnet.address.startsWith("tb1q")).toBe(true);
  });

  it("exposes the two paths as constants that differ only in the coin type", () => {
    expect(MAINNET_ACCOUNT_PATH).toBe("m/84'/0'/0'/0/0");
    expect(TESTNET_ACCOUNT_PATH).toBe("m/84'/1'/0'/0/0");
    expect(BITCOIN_PATHS.mainnet).toBe(MAINNET_ACCOUNT_PATH);
    expect(BITCOIN_PATHS.testnet).toBe(TESTNET_ACCOUNT_PATH);
  });

  it("returns public material only from deriveBitcoinAccount", () => {
    const account = deriveBitcoinAccount(TEST_MNEMONIC, "mainnet");
    // There must be no field a caller could accidentally serialise into a request
    // body or a log line.
    expect(Object.keys(account).sort()).toEqual(["address", "network", "path", "publicKey"]);
    expect(account.publicKey).toMatch(/^0[23][0-9a-f]{64}$/);
  });

  it("refuses a phrase that is not valid, and says why", () => {
    expect(canDeriveBitcoin("not a real recovery phrase at all").ok).toBe(false);
    expect(canDeriveBitcoin("").reason).toMatch(/no recovery phrase/i);
    expect(() => deriveBitcoinAccount("abandon abandon", "mainnet")).toThrow(/not valid/i);
  });

  it("normalises whitespace and case, because a pasted phrase carries both", () => {
    const messy = `  ${TEST_MNEMONIC.toUpperCase().replace(/ /g, "   ")}\n`;
    expect(deriveBitcoinAccount(messy, "mainnet").address).toBe(BIP84_FIRST_MAINNET_ADDRESS);
  });

  it("rejects an unknown network rather than guessing one", () => {
    expect(() => deriveBitcoinAccount(TEST_MNEMONIC, "regtest")).toThrow(/mainnet.*testnet/i);
  });
});

describe("vsize estimation", () => {
  /**
   * Measured against @scure/btc-signer by building, signing and reading .vsize.
   * If the estimator drifts from these, every fee this wallet pays is wrong.
   */
  it("matches the vsize of a real signed transaction", () => {
    expect(estimateVsize(1, [P2WPKH_SCRIPT_LEN, P2WPKH_SCRIPT_LEN])).toBe(141);
    expect(estimateVsize(2, [P2WPKH_SCRIPT_LEN])).toBe(178);
    expect(estimateVsize(1, [P2WPKH_SCRIPT_LEN])).toBe(110);
  });

  it("charges more for a larger destination script, such as taproot", () => {
    // A P2TR output script is 34 bytes against P2WPKH's 22, so it costs 12 more
    // vbytes. Assuming one output size for all destinations would underpay.
    expect(estimateVsize(1, [34, P2WPKH_SCRIPT_LEN])).toBe(estimateVsize(1, [22, P2WPKH_SCRIPT_LEN]) + 12);
  });

  it("rounds the fee up, because a partial vbyte still has to be paid for", () => {
    // 110 vbytes at 1.5 sat/vB is 165 exactly; at 1.4 it is 154 exactly. Use a
    // rate that lands on a fraction.
    expect(estimateFee(1, [P2WPKH_SCRIPT_LEN], 1.001)).toBe(111);
  });
});

describe("coin selection", () => {
  const base = {
    amountSats: 50000,
    feeRateSatPerVb: 10,
    destScriptLen: P2WPKH_SCRIPT_LEN,
    changeScriptLen: P2WPKH_SCRIPT_LEN,
  };

  it("covers the amount plus the fee, and returns change above the dust floor", () => {
    const result = selectUtxos({ ...base, utxos: [{ txid: "a", vout: 0, value: 200000 }] });

    expect(result.ok).toBe(true);
    expect(result.hasChange).toBe(true);
    // 141 vbytes at 10 sat/vB.
    expect(result.fee).toBe(1410);
    expect(result.change).toBe(200000 - 50000 - 1410);
    expect(result.change).toBeGreaterThanOrEqual(DUST_LIMIT_SATS);
    // Conservation: every satoshi of input is either sent, returned or burned.
    expect(result.inputTotal).toBe(base.amountSats + result.fee + result.change);
  });

  it("adds another input when the first covers the amount but not the fee", () => {
    const result = selectUtxos({
      ...base,
      utxos: [
        { txid: "a", vout: 0, value: 51000 },
        { txid: "b", vout: 0, value: 3000 },
      ],
    });

    // 51000 alone is more than the 50000 being sent, so a selector that ignored
    // the fee would have stopped there and built a transaction 100 satoshis short
    // of the rate it promised. It sits unconfirmed with no error anywhere.
    expect(51000).toBeGreaterThan(base.amountSats);

    expect(result.ok).toBe(true);
    expect(result.selected).toHaveLength(2);
    expect(result.inputTotal).toBe(54000);
    // 209 vbytes for two inputs and two outputs, at 10 sat/vB.
    expect(result.fee).toBe(2090);
    expect(result.change).toBe(1910);
    expect(result.inputTotal).toBeGreaterThanOrEqual(base.amountSats + result.fee);
  });

  it("takes the largest coins first, so the fee stays low and the choice is deterministic", () => {
    const result = selectUtxos({
      ...base,
      utxos: [
        { txid: "small", vout: 0, value: 1000 },
        { txid: "big", vout: 0, value: 900000 },
        { txid: "medium", vout: 0, value: 5000 },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].txid).toBe("big");
  });

  it("refuses when the coins cannot cover the amount plus the fee, and says by how much", () => {
    const result = selectUtxos({ ...base, utxos: [{ txid: "a", vout: 0, value: 50100 }] });

    expect(result.ok).toBe(false);
    // The refusal has to be readable on a screen. "Insufficient funds" would not
    // tell the user that it is the fee, not the amount, that they are short of.
    expect(result.reason).toContain("50000");
    expect(result.reason).toContain("50100");
    expect(result.reason).toMatch(/cannot cover/i);
  });

  it("refuses an empty set rather than returning a transaction with no inputs", () => {
    const result = selectUtxos({ ...base, utxos: [] });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/cannot cover/i);
  });
});

describe("the dust floor", () => {
  /**
   * The case this floor exists for.
   *
   * One input of 100000 sending 99500 at 1 sat/vB. The two output shape costs
   * 141, leaving 359 of change, which is under the 546 floor. An output that size
   * costs more to spend than it is worth and the network will not relay it, so
   * the whole 500 satoshi remainder becomes fee and the change output is not
   * created at all.
   */
  it("adds sub dust change to the fee instead of creating an unspendable output", () => {
    const result = selectUtxos({
      utxos: [{ txid: "a", vout: 0, value: 100000 }],
      amountSats: 99500,
      feeRateSatPerVb: 1,
      destScriptLen: P2WPKH_SCRIPT_LEN,
      changeScriptLen: P2WPKH_SCRIPT_LEN,
    });

    expect(result.ok).toBe(true);
    expect(result.hasChange).toBe(false);
    expect(result.change).toBe(0);
    // Fee is the entire remainder, not the estimate. In Bitcoin the fee is
    // whatever the outputs do not claim.
    expect(result.fee).toBe(500);
    expect(result.fee).toBeGreaterThan(estimateFee(1, [P2WPKH_SCRIPT_LEN], 1));
  });

  it("creates the change output the moment the remainder reaches the floor", () => {
    // One satoshi either side of the boundary must behave differently, and the
    // boundary must be the floor itself, not near it.
    const at = (amount) =>
      selectUtxos({
        utxos: [{ txid: "a", vout: 0, value: 100000 }],
        amountSats: amount,
        feeRateSatPerVb: 1,
        destScriptLen: P2WPKH_SCRIPT_LEN,
        changeScriptLen: P2WPKH_SCRIPT_LEN,
      });

    // change = 100000 - amount - 141
    const amountForExactDust = 100000 - 141 - DUST_LIMIT_SATS; // change === 546
    expect(at(amountForExactDust).hasChange).toBe(true);
    expect(at(amountForExactDust).change).toBe(DUST_LIMIT_SATS);
    expect(at(amountForExactDust + 1).hasChange).toBe(false);
  });

  it("refuses to send an amount that is itself below the dust floor", () => {
    const account = deriveBitcoinAccount(TEST_MNEMONIC, "testnet");
    const result = buildP2wpkhSpend({
      utxos: [{ txid: "aa".repeat(32), vout: 0, value: 100000, confirmed: true }],
      fromAddress: account.address,
      toAddress: account.address,
      amountSats: DUST_LIMIT_SATS - 1,
      feeRateSatPerVb: 1,
      privateKey: deriveBitcoinPrivateKey(TEST_MNEMONIC, "testnet"),
      network: "testnet",
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/dust limit/i);
  });
});

describe("building and signing a spend", () => {
  const network = "testnet";
  const account = deriveBitcoinAccount(TEST_MNEMONIC, network);
  const privateKey = deriveBitcoinPrivateKey(TEST_MNEMONIC, network);
  // A second, unrelated destination on the same network, derived from the same
  // test vector on mainnet's account so it is definitely a different key.
  const destination = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";

  const spend = (over = {}) =>
    buildP2wpkhSpend({
      utxos: [{ txid: "aa".repeat(32), vout: 0, value: 200000, confirmed: true }],
      fromAddress: account.address,
      toAddress: destination,
      amountSats: 50000,
      feeRateSatPerVb: 10,
      privateKey,
      network,
      ...over,
    });

  it("returns broadcastable hex with an explicit change output back to the sender", () => {
    const result = spend();
    expect(result.ok).toBe(true);
    expect(result.hex).toMatch(/^[0-9a-f]+$/);
    expect(result.txid).toMatch(/^[0-9a-f]{64}$/);

    const tx = decode(result.hex);
    expect(tx.inputsLength).toBe(1);
    // Two outputs: the payment and the change. A missing change output would hand
    // 148590 satoshis to a miner.
    expect(tx.outputsLength).toBe(2);
    expect(result.change).toBeGreaterThan(DUST_LIMIT_SATS);
  });

  it("signs to the vsize it estimated, so the fee rate it promised is the one it pays", () => {
    const result = spend();
    expect(result.vsize).toBe(estimateVsize(1, [P2WPKH_SCRIPT_LEN, P2WPKH_SCRIPT_LEN]));
    expect(result.feeRateSatPerVb).toBeGreaterThanOrEqual(10);
  });

  it("produces one output only when the change would be dust", () => {
    const result = spend({ amountSats: 199500, feeRateSatPerVb: 1 });
    expect(result.ok).toBe(true);
    expect(result.change).toBe(0);
    expect(decode(result.hex).outputsLength).toBe(1);
  });

  it("refuses a destination on the wrong network instead of paying nobody", () => {
    const result = spend({ toAddress: BIP84_FIRST_MAINNET_ADDRESS });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not usable on testnet/i);
  });

  it("refuses when the inputs cannot cover the amount plus the fee", () => {
    const result = spend({ utxos: [{ txid: "bb".repeat(32), vout: 0, value: 51000, confirmed: true }] });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/cannot cover/i);
  });

  it("will not spend unconfirmed coins by default, and says that is why", () => {
    const unconfirmed = [{ txid: "cc".repeat(32), vout: 0, value: 200000, confirmed: false }];
    const refused = spend({ utxos: unconfirmed });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/unconfirmed/i);

    const allowed = spend({ utxos: unconfirmed, allowUnconfirmed: true });
    expect(allowed.ok).toBe(true);
  });

  it("refuses a key that is not thirty two bytes rather than signing with rubbish", () => {
    const result = spend({ privateKey: new Uint8Array(31) });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/thirty two bytes/i);
  });

  it("keeps every satoshi accounted for", () => {
    const result = spend();
    // input total = amount sent + fee + change. Nothing is created and nothing
    // disappears; anything not claimed by an output is fee, by definition.
    expect(result.inputTotal).toBe(50000 + result.fee + result.change);
  });

  it("marks every input replaceable under BIP 125", () => {
    // 0xffffffff is FINAL and cannot be bumped. A stuck payment with that
    // sequence sits in the mempool for up to two weeks with the coins locked.
    const result = spend({
      utxos: [
        { txid: "aa".repeat(32), vout: 0, value: 30000, confirmed: true },
        { txid: "bb".repeat(32), vout: 1, value: 30000, confirmed: true },
      ],
    });
    expect(result.ok).toBe(true);
    const tx = decode(result.hex);
    expect(tx.inputsLength).toBe(2);
    for (let i = 0; i < tx.inputsLength; i++) {
      expect(tx.getInput(i).sequence).toBe(RBF_SEQUENCE);
    }
    expect(RBF_SEQUENCE).toBeLessThan(0xfffffffe);
  });
});

describe("planning before signing", () => {
  const network = "testnet";
  const account = deriveBitcoinAccount(TEST_MNEMONIC, network);
  const privateKey = deriveBitcoinPrivateKey(TEST_MNEMONIC, network);
  const destination = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
  const utxos = [
    { txid: "aa".repeat(32), vout: 0, value: 120000, confirmed: true },
    { txid: "bb".repeat(32), vout: 0, value: 80000, confirmed: true },
    { txid: "cc".repeat(32), vout: 0, value: 5000, confirmed: true },
  ];
  const args = {
    utxos,
    fromAddress: account.address,
    toAddress: destination,
    amountSats: 150000,
    feeRateSatPerVb: 12,
    network,
  };

  it("plans with no key and the signed transaction matches the plan to the satoshi", () => {
    const plan = planP2wpkhSpend(args);
    expect(plan.ok).toBe(true);
    expect(plan.inputs).toHaveLength(2);
    expect(plan.inputs.map((u) => u.txid)).toEqual(["aa".repeat(32), "bb".repeat(32)]);

    // The review screen shows `plan`; the signer is handed the same inputs.
    const built = buildP2wpkhSpend({ ...args, forceInputs: plan.inputs, privateKey });
    expect(built.ok).toBe(true);
    expect(built.fee).toBe(plan.fee);
    expect(built.change).toBe(plan.change);
    expect(built.vsize).toBe(plan.vsize);
    expect(built.inputs).toEqual(plan.inputs);
  });

  it("with forced inputs spends exactly those and refuses if they cannot cover", () => {
    const one = [utxos[2]];
    const short = planP2wpkhSpend({ ...args, forceInputs: one, amountSats: 4000 });
    expect(short.ok).toBe(false);
    expect(short.reason).toMatch(/cannot cover/i);

    const fine = planP2wpkhSpend({ ...args, forceInputs: [utxos[0]], amountSats: 100000 });
    expect(fine.ok).toBe(true);
    expect(fine.inputs).toEqual([utxos[0]]);
  });

  it("validates a destination for the right network before anything else", () => {
    expect(validateDestination(destination, "testnet").ok).toBe(true);
    const wrong = validateDestination(BIP84_FIRST_MAINNET_ADDRESS, "testnet");
    expect(wrong.ok).toBe(false);
    expect(wrong.reason).toMatch(/not usable on testnet/i);
    expect(validateDestination("", "testnet").ok).toBe(false);
    expect(validateDestination("not an address", "mainnet").ok).toBe(false);
  });

  it("refuses a fee rate below the minimum relay rate rather than assuming one", () => {
    expect(planP2wpkhSpend({ ...args, feeRateSatPerVb: 0 }).ok).toBe(false);
    expect(planP2wpkhSpend({ ...args, feeRateSatPerVb: NaN }).ok).toBe(false);
    expect(planP2wpkhSpend({ ...args, feeRateSatPerVb: 0.5 }).ok).toBe(false);
  });
});

describe("replace by fee", () => {
  const network = "testnet";
  const account = deriveBitcoinAccount(TEST_MNEMONIC, network);
  const privateKey = deriveBitcoinPrivateKey(TEST_MNEMONIC, network);
  const destination = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
  const inputs = [{ txid: "aa".repeat(32), vout: 0, value: 200000, confirmed: true }];
  const original = buildP2wpkhSpend({
    utxos: inputs,
    fromAddress: account.address,
    toAddress: destination,
    amountSats: 50000,
    feeRateSatPerVb: 5,
    privateKey,
    network,
  });
  const replacing = { fee: original.fee, feeRateSatPerVb: original.feeRateSatPerVb };

  it("accepts a replacement that pays the old fee plus its own relay cost at a higher rate", () => {
    const bumped = buildP2wpkhSpend({
      utxos: inputs,
      forceInputs: original.inputs,
      fromAddress: account.address,
      toAddress: destination,
      amountSats: 50000,
      feeRateSatPerVb: 8,
      privateKey,
      network,
      allowUnconfirmed: true,
      replacing,
    });
    expect(bumped.ok).toBe(true);
    expect(bumped.fee).toBeGreaterThanOrEqual(original.fee + bumped.vsize);
    // Same coins, same payee, same amount: only the fee and the change moved.
    expect(decode(bumped.hex).inputsLength).toBe(1);
    expect(bumped.inputs).toEqual(original.inputs);
    expect(bumped.txid).not.toBe(original.txid);
  });

  it("refuses a replacement that does not raise the rate, and says the minimum", () => {
    const same = planP2wpkhSpend({
      utxos: inputs,
      forceInputs: original.inputs,
      fromAddress: account.address,
      toAddress: destination,
      amountSats: 50000,
      feeRateSatPerVb: 5,
      network,
      allowUnconfirmed: true,
      replacing,
    });
    expect(same.ok).toBe(false);
    expect(same.reason).toMatch(/must pay at least|higher than/i);
  });

  it("plans a cancellation back to the sender that clears the BIP 125 rules", () => {
    const cancel = planCancel({
      inputs: original.inputs,
      fromAddress: account.address,
      feeRateSatPerVb: 9,
      network,
      replacing,
    });
    expect(cancel.ok).toBe(true);
    expect(cancel.fee).toBeGreaterThanOrEqual(original.fee + cancel.vsize);
    // Everything except the fee comes home.
    expect(cancel.amountSats + cancel.fee).toBe(200000);

    const signed = buildP2wpkhSpend({
      utxos: original.inputs,
      forceInputs: original.inputs,
      fromAddress: account.address,
      toAddress: account.address,
      amountSats: cancel.amountSats,
      feeRateSatPerVb: 9,
      privateKey,
      network,
      allowUnconfirmed: true,
      replacing,
      allowFeeAboveAmount: true,
    });
    expect(signed.ok).toBe(true);
    expect(decode(signed.hex).outputsLength).toBe(1);
  });
});

describe("the cached receive address", () => {
  const store = new Map();
  const fakeStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  const mainnet = BIP84_FIRST_MAINNET_ADDRESS;
  const evmA = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const evmB = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

  beforeEach(() => {
    store.clear();
    globalThis.localStorage = fakeStorage;
  });

  it("does not hand one keystore's address to another keystore", () => {
    // Wallet A unlocks Bitcoin once. Then the owner imports phrase B into the
    // same account. The address remembered for A must NOT appear for B: it is
    // an address B cannot sign for, and a customer paid there loses the coins.
    cacheBitcoinAddress("user1", "mainnet", mainnet, evmA);
    expect(readCachedBitcoinAddress("user1", "mainnet", evmA)).toBe(mainnet);
    expect(readCachedBitcoinAddress("user1", "mainnet", evmB)).toBeNull();
  });

  it("keeps networks apart", () => {
    cacheBitcoinAddress("user1", "mainnet", mainnet, evmA);
    expect(readCachedBitcoinAddress("user1", "testnet", evmA)).toBeNull();
  });

  it("refuses to cache or return anything that is not an address of that network", () => {
    cacheBitcoinAddress("user1", "mainnet", "tb1qnotmainnet", evmA);
    expect(readCachedBitcoinAddress("user1", "mainnet", evmA)).toBeNull();
    // A value smuggled into the slot by hand is still checked on the way out.
    store.set(`ledgerwatch.wallet.btc.user1.${evmA.toLowerCase()}.mainnet`, "garbage");
    expect(readCachedBitcoinAddress("user1", "mainnet", evmA)).toBeNull();
    expect(isPlausibleBitcoinAddress(mainnet, "mainnet")).toBe(true);
    expect(isPlausibleBitcoinAddress(mainnet, "testnet")).toBe(false);
  });

  it("clears every entry for an account, including the old key shape", () => {
    cacheBitcoinAddress("user1", "mainnet", mainnet, evmA);
    store.set("ledgerwatch.wallet.btc.user1.mainnet", mainnet); // pre fix format
    cacheBitcoinAddress("user2", "mainnet", mainnet, evmA);
    clearBitcoinAddressCache("user1");
    expect(readCachedBitcoinAddress("user1", "mainnet", evmA)).toBeNull();
    expect(store.has("ledgerwatch.wallet.btc.user1.mainnet")).toBe(false);
    // Another account's cache is untouched.
    expect(readCachedBitcoinAddress("user2", "mainnet", evmA)).toBe(mainnet);
  });
});
