import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";
import * as btc from "@scure/btc-signer";

export const MAINNET_ACCOUNT_PATH = "m/84'/0'/0'/0/0";

export const TESTNET_ACCOUNT_PATH = "m/84'/1'/0'/0/0";

export const BITCOIN_PATHS = Object.freeze({
  mainnet: MAINNET_ACCOUNT_PATH,
  testnet: TESTNET_ACCOUNT_PATH,
});

export const BITCOIN_NETWORKS = Object.freeze(["mainnet", "testnet"]);

export function networkParams(network) {
  assertNetwork(network);
  return network === "mainnet" ? btc.NETWORK : btc.TEST_NETWORK;
}

function assertNetwork(network) {
  if (!BITCOIN_NETWORKS.includes(network)) {
    throw new Error('Network must be either "mainnet" or "testnet".');
  }
}

export function canDeriveBitcoin(mnemonic) {
  if (typeof mnemonic !== "string" || mnemonic.trim().length === 0) {
    return {
      ok: false,
      reason:
        "This wallet has no recovery phrase, so a Bitcoin account cannot be derived from it. " +
        "Wallets imported from a bare private key carry no seed to derive from.",
    };
  }
  if (!bip39.validateMnemonic(normalise(mnemonic), wordlist)) {
    return { ok: false, reason: "That recovery phrase is not valid. Check the spelling and the word order." };
  }
  return { ok: true };
}

function normalise(mnemonic) {
  return mnemonic.trim().toLowerCase().split(/\s+/).join(" ");
}

function deriveNode(mnemonic, network) {
  assertNetwork(network);
  const check = canDeriveBitcoin(mnemonic);
  if (!check.ok) throw new Error(check.reason);

  const seed = bip39.mnemonicToSeedSync(normalise(mnemonic));
  const node = HDKey.fromMasterSeed(seed).derive(BITCOIN_PATHS[network]);
  if (!node.privateKey) {
    throw new Error("That recovery phrase did not produce a usable Bitcoin key.");
  }
  return node;
}

export function deriveBitcoinAccount(mnemonic, network) {
  const node = deriveNode(mnemonic, network);
  const payment = btc.p2wpkh(node.publicKey, networkParams(network));
  return {
    address: payment.address,
    publicKey: bytesToHex(node.publicKey),
    path: BITCOIN_PATHS[network],
    network,
  };
}

export function deriveBitcoinPrivateKey(mnemonic, network) {
  return deriveNode(mnemonic, network).privateKey;
}

export function signBitcoinTransaction(tx, privateKey) {
  if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
    throw new Error("A signing key is required and must be thirty two bytes.");
  }
  if (tx.inputsLength === 0) {
    throw new Error("There is nothing to sign: this transaction has no inputs.");
  }

  const signed = tx.sign(privateKey);
  if (signed !== tx.inputsLength) {
    throw new Error(
      `This wallet could sign only ${signed} of ${tx.inputsLength} inputs, so the transaction was not completed.`
    );
  }
  tx.finalize();

  return {
    hex: bytesToHex(tx.extract()),
    txid: tx.id,
    vsize: tx.vsize,
    fee: Number(tx.fee),
  };
}

function bytesToHex(bytes) {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
