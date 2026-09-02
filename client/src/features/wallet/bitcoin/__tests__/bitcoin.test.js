import { describe, it, expect } from "vitest";
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
  buildP2wpkhSpend,
  estimateFee,
  estimateVsize,
  selectUtxos,
} from "../tx.js";

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
});
