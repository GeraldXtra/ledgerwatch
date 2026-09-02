import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";
import * as btc from "@scure/btc-signer";

/**
 * BIP 84 NATIVE SEGWIT DERIVATION FOR THE BITCOIN SIDE OF THE WALLET.
 *
 * ---------------------------------------------------------------------------
 * ONE RECOVERY PHRASE, BOTH CHAINS
 * ---------------------------------------------------------------------------
 * The Bitcoin account is derived from the SAME BIP 39 mnemonic the EVM wallet
 * already uses, so a single phrase written on a single piece of paper restores
 * both. Two phrases would be two things to lose, and the one people lose is the
 * one they were told mattered less.
 *
 * That is safe because the two branches are disjoint at the very first hardened
 * level and can never collide:
 *
 *     EVM      m/44'/60'/0'/0/0        BIP 44, coin type 60
 *     Bitcoin  m/84'/0'/0'/0/0         BIP 84, coin type 0    (mainnet)
 *     Bitcoin  m/84'/1'/0'/0/0         BIP 84, coin type 1    (testnet)
 *
 * Invoice addresses on the EVM side live at m/44'/60'/0'/2/index, a change level
 * no standard wallet touches. Nothing here goes near it.
 *
 * ---------------------------------------------------------------------------
 * WHY COIN TYPE 0 VERSUS 1 IS WHAT SEPARATES MAINNET FROM TESTNET
 * ---------------------------------------------------------------------------
 * SLIP 44 assigns coin type 0 to Bitcoin and coin type 1 to "testnet, all coins".
 * BIP 84 inherits that, so the ONLY difference between the mainnet and testnet
 * paths below is a single hardened index. Both then get encoded with a different
 * human readable part in the address: bc1 for mainnet, tb1 for testnet.
 *
 * This matters more than it looks. If the two networks shared a path, the same
 * key would control both addresses and a testnet habit would be one typo away
 * from a real spend. Because they do not, a testnet key literally cannot sign for
 * a mainnet address, and every wallet that implements BIP 84 restores the same
 * two accounts from the same phrase. Change either constant and a user's funds
 * become unreachable from every other wallet on earth, while this app carries on
 * showing an address that looks perfectly fine.
 *
 * ---------------------------------------------------------------------------
 * SECRETS
 * ---------------------------------------------------------------------------
 * Nothing in this module is stored, cached, logged or sent anywhere. The mnemonic
 * arrives as an argument, is used, and is the caller's to discard. `deriveBitcoinAccount`
 * returns PUBLIC material only, so the common path never has a secret in hand at
 * all. The one function that yields a private key says so in its name, and the
 * signing helper takes the key as a parameter and holds no module state, so there
 * is no object anywhere that quietly keeps one alive.
 */

/**
 * The full external receive path for the first Bitcoin account.
 *
 * Read as purpose' / coin type' / account' / change / index:
 *   84'  BIP 84, native segwit (P2WPKH, bech32, bc1)
 *   0'   coin type 0, Bitcoin mainnet
 *   0'   the first account
 *   0    the external chain, meaning addresses handed to other people
 *   0    the first address on it
 */
export const MAINNET_ACCOUNT_PATH = "m/84'/0'/0'/0/0";

/** As above, with SLIP 44 coin type 1: testnet. This is the only difference. */
export const TESTNET_ACCOUNT_PATH = "m/84'/1'/0'/0/0";

export const BITCOIN_PATHS = Object.freeze({
  mainnet: MAINNET_ACCOUNT_PATH,
  testnet: TESTNET_ACCOUNT_PATH,
});

export const BITCOIN_NETWORKS = Object.freeze(["mainnet", "testnet"]);

/**
 * The address version bytes @scure/btc-signer uses when encoding.
 *
 * Exported so `tx.js` encodes outputs against the same network object the address
 * was derived with. A mismatch here does not throw, it silently produces an
 * address on the wrong network, which is the failure that loses coins outright.
 */
export function networkParams(network) {
  assertNetwork(network);
  return network === "mainnet" ? btc.NETWORK : btc.TEST_NETWORK;
}

function assertNetwork(network) {
  if (!BITCOIN_NETWORKS.includes(network)) {
    throw new Error('Network must be either "mainnet" or "testnet".');
  }
}

/**
 * Is this phrase usable for Bitcoin derivation?
 *
 * A wallet imported from a bare private key has no mnemonic. That is arithmetic,
 * not a missing feature: a single key carries no seed to reconstruct, so no
 * amount of code can derive a Bitcoin account from it. The EVM side already
 * reports this through `canDerive()`; this is the same idea, so the UI can say
 * why rather than showing an empty Bitcoin panel with no explanation.
 *
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
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

/**
 * BIP 39 normalises on whitespace: single spaces, no leading or trailing padding,
 * lowercase. A phrase pasted out of a text file routinely carries a trailing
 * newline or a double space, and an unnormalised phrase derives a DIFFERENT seed
 * without ever looking wrong, which presents as "my wallet is empty".
 */
function normalise(mnemonic) {
  return mnemonic.trim().toLowerCase().split(/\s+/).join(" ");
}

/**
 * Derive the BIP 84 node for a network. Private, because the returned node holds
 * the private key and must not escape this module by accident.
 */
function deriveNode(mnemonic, network) {
  assertNetwork(network);
  const check = canDeriveBitcoin(mnemonic);
  if (!check.ok) throw new Error(check.reason);

  // No BIP 39 passphrase. The EVM wallet does not use one either, and a phrase
  // that silently needs a thirteenth secret to restore is a phrase people cannot
  // actually restore from.
  const seed = bip39.mnemonicToSeedSync(normalise(mnemonic));
  const node = HDKey.fromMasterSeed(seed).derive(BITCOIN_PATHS[network]);
  if (!node.privateKey) {
    throw new Error("That recovery phrase did not produce a usable Bitcoin key.");
  }
  return node;
}

/**
 * PUBLIC account details for a network. Carries no secret at all.
 *
 * This is what the rest of the app should call. There is deliberately no private
 * key on the returned object, so an address can be displayed, stored or sent to
 * the server without anyone having to remember to strip a field first.
 *
 * @param {string} mnemonic  a valid BIP 39 phrase, discarded by the caller after
 * @param {"mainnet"|"testnet"} network
 * @returns {{address:string, publicKey:string, path:string, network:string}}
 */
export function deriveBitcoinAccount(mnemonic, network) {
  const node = deriveNode(mnemonic, network);
  const payment = btc.p2wpkh(node.publicKey, networkParams(network));
  return {
    address: payment.address,
    // Hex rather than bytes, because this is the form that gets displayed and
    // compared. The bytes stay inside the module.
    publicKey: bytesToHex(node.publicKey),
    path: BITCOIN_PATHS[network],
    network,
  };
}

/**
 * The private key for a network, as raw bytes.
 *
 * Named so that nobody calls it thinking it is the safe one. The returned bytes
 * are the only thing standing between the user and an empty wallet: they must not
 * be stored, logged, put in a request body, or held past the single transaction
 * they were fetched for. Hand them straight to `signBitcoinTransaction` and let
 * them fall out of scope.
 *
 * @returns {Uint8Array} 32 bytes
 */
export function deriveBitcoinPrivateKey(mnemonic, network) {
  return deriveNode(mnemonic, network).privateKey;
}

/**
 * THE SIGNING HELPER.
 *
 * Takes the private key as an argument and keeps nothing. There is no module
 * level variable here, no cache and no closure that outlives the call, so there
 * is no place a key could linger after the caller drops it. That is the same
 * discipline as the EVM side, where every broadcast site obtains a signer from
 * `unlockWallet` with a password typed for THAT transaction rather than reusing
 * one held open.
 *
 * Signs every input and finalises, because a partially signed transaction is not
 * broadcastable and returning one would produce a confusing rejection from the
 * network instead of a clear error here.
 *
 * @param {import("@scure/btc-signer").Transaction} tx  an unsigned transaction
 * @param {Uint8Array} privateKey                       32 raw bytes
 * @returns {{hex:string, txid:string, vsize:number, fee:number}}
 */
export function signBitcoinTransaction(tx, privateKey) {
  if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
    throw new Error("A signing key is required and must be thirty two bytes.");
  }
  if (tx.inputsLength === 0) {
    throw new Error("There is nothing to sign: this transaction has no inputs.");
  }

  const signed = tx.sign(privateKey);
  if (signed !== tx.inputsLength) {
    // Every input in a single address spend is locked to the same key, so a
    // partial result means an input was selected that this wallet does not own.
    // Broadcasting it would waste a round trip and return an opaque script error.
    throw new Error(
      `This wallet could sign only ${signed} of ${tx.inputsLength} inputs, so the transaction was not completed.`
    );
  }
  tx.finalize();

  return {
    hex: bytesToHex(tx.extract()),
    txid: tx.id,
    // Read back from the SIGNED transaction, not estimated. The estimate decided
    // the fee; this is what the fee actually bought, and the two are worth being
    // able to compare when a fee looks wrong.
    vsize: tx.vsize,
    fee: Number(tx.fee),
  };
}

/** Lowercase hex, no prefix. Bitcoin tooling does not use an 0x prefix. */
function bytesToHex(bytes) {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
