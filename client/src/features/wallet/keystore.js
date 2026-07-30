import { ethers } from "ethers";
import { getToken } from "../../api/http";

/**
 * NON-CUSTODIAL KEY STORAGE — the security core of the wallet.
 *
 * The private key and mnemonic exist only transiently in memory during
 * generate / import / sign. The ONLY thing ever written to localStorage is the
 * ethers encrypted JSON keystore (Web3 Secret Storage v3: scrypt KDF, AES-128-CTR,
 * keccak256 MAC). The plaintext key is never persisted, never logged, and never
 * placed in any network request. The server only ever learns the PUBLIC address.
 *
 * SCOPED PER ACCOUNT. The keystore used to live under one global key, which meant
 * a wallet created on any account became the wallet of every account in the same
 * browser: a second account would skip the "create a wallet" screen entirely and
 * show somebody else's address, and only the original account's password could
 * open it. The storage key now carries the account id, so accounts are isolated.
 *
 * The id comes from the JWT the app already sends on every request, so it can
 * never drift out of step with whoever is actually logged in.
 */

const BASE_KEY = "ledgerwatch.wallet.keystore";

/**
 * The pre-scoping key. READ ONLY, and referenced nowhere except the explicit
 * one-time claim below. It is deliberately never auto-adopted — silently
 * adopting it for whichever account happens to log in first is the bug this
 * module was changed to fix.
 */
export const LEGACY_KEY = BASE_KEY;

/** Account id from the bearer token's payload, or null when logged out. */
function activeUserId() {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    // base64url -> base64 before decoding.
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const id = JSON.parse(json).id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

/**
 * Storage key for the logged-in account, or null when there is no session.
 *
 * Returning null rather than falling back to BASE_KEY is deliberate: a
 * logged-out page must not be able to see, unlock, or overwrite any wallet.
 */
function activeStorageKey() {
  const id = activeUserId();
  return id ? `${BASE_KEY}.${id}` : null;
}

function readKeystore() {
  const key = activeStorageKey();
  return key ? localStorage.getItem(key) : null;
}

export function hasWallet() {
  return Boolean(readKeystore());
}

export function getKeystoreJson() {
  return readKeystore();
}

/** The public address inside a keystore JSON, WITHOUT decrypting it. */
function addressFromKeystore(json) {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed.address ? ethers.getAddress("0x" + parsed.address.replace(/^0x/, "")) : null;
  } catch {
    return null;
  }
}

// Read the public address out of THIS ACCOUNT's stored keystore.
export function getStoredAddress() {
  return addressFromKeystore(readKeystore());
}

export function clearWallet() {
  const key = activeStorageKey();
  if (key) localStorage.removeItem(key);
}

// ---- Legacy wallet recovery (explicit, one time) --------------------------

/**
 * A wallet left in this browser from before accounts were separated, if any.
 * Surfaced so it can be CLAIMED on purpose rather than silently inherited.
 * @returns {{address:string}|null}
 */
export function getLegacyWallet() {
  const json = localStorage.getItem(LEGACY_KEY);
  if (!json) return null;
  const address = addressFromKeystore(json);
  return address ? { address } : null;
}

/**
 * Move the legacy keystore to the logged-in account and remove the legacy entry,
 * so no second account can claim the same wallet. Returns the address.
 */
export function claimLegacyWallet() {
  const key = activeStorageKey();
  if (!key) throw new Error("You need to be signed in to claim this wallet.");
  const json = localStorage.getItem(LEGACY_KEY);
  if (!json) throw new Error("There is no earlier wallet in this browser.");
  const address = addressFromKeystore(json);
  if (!address) throw new Error("That earlier wallet could not be read.");

  localStorage.setItem(key, json);
  localStorage.removeItem(LEGACY_KEY);
  return address;
}

/** Forget the legacy wallet without claiming it. */
export function discardLegacyWallet() {
  localStorage.removeItem(LEGACY_KEY);
}

// ---- Create / import ------------------------------------------------------

// Fresh wallet with a BIP-39 mnemonic. Returned in-memory only — the caller shows
// the phrase once, then must call encryptAndStore to persist the ENCRYPTED form.
export function createWallet() {
  const wallet = ethers.Wallet.createRandom();
  return {
    wallet,
    address: wallet.address,
    mnemonic: wallet.mnemonic ? wallet.mnemonic.phrase : null,
    privateKey: wallet.privateKey,
  };
}

export function importFromMnemonic(phrase) {
  const wallet = ethers.Wallet.fromPhrase(phrase.trim());
  return { wallet, address: wallet.address };
}

export function importFromPrivateKey(pk) {
  const key = pk.trim();
  const wallet = new ethers.Wallet(key.startsWith("0x") ? key : "0x" + key);
  return { wallet, address: wallet.address };
}

/**
 * Encrypt the wallet with the user's password (scrypt) and store ONLY the
 * ciphertext JSON, under the logged-in account's key. Returns the public address.
 * @param {ethers.Wallet|ethers.HDNodeWallet} wallet
 * @param {string} password
 * @param {(pct:number)=>void} [onProgress]
 */
export async function encryptAndStore(wallet, password, onProgress) {
  const key = activeStorageKey();
  if (!key) throw new Error("You need to be signed in to save a wallet.");
  const json = await wallet.encrypt(password, onProgress);
  localStorage.setItem(key, json);
  return wallet.address;
}

/**
 * Decrypt THIS ACCOUNT's keystore with the password and return a live Wallet. The
 * decrypted key lives only in the returned object for the duration of one signing
 * operation — the caller must not persist or transmit it.
 * @param {string} password
 * @param {(pct:number)=>void} [onProgress]
 * @returns {Promise<ethers.Wallet>}
 */
export async function unlockWallet(password, onProgress) {
  const json = readKeystore();
  if (!json) throw new Error("No wallet on this device for this account");
  return ethers.Wallet.fromEncryptedJson(json, password, onProgress);
}
