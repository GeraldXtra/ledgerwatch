import { ethers } from "ethers";

/**
 * NON-CUSTODIAL KEY STORAGE — the security core of the wallet.
 *
 * The private key and mnemonic exist only transiently in memory during
 * generate / import / sign. The ONLY thing ever written to localStorage is the
 * ethers encrypted JSON keystore (Web3 Secret Storage v3: scrypt KDF, AES-128-CTR,
 * keccak256 MAC). The plaintext key is never persisted, never logged, and never
 * placed in any network request. The server only ever learns the PUBLIC address.
 */

const STORAGE_KEY = "ledgerwatch.wallet.keystore";

export function hasWallet() {
  return Boolean(localStorage.getItem(STORAGE_KEY));
}

export function getKeystoreJson() {
  return localStorage.getItem(STORAGE_KEY);
}

// Read the public address out of the stored keystore WITHOUT decrypting it.
export function getStoredAddress() {
  const json = localStorage.getItem(STORAGE_KEY);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed.address ? ethers.getAddress("0x" + parsed.address.replace(/^0x/, "")) : null;
  } catch {
    return null;
  }
}

export function clearWallet() {
  localStorage.removeItem(STORAGE_KEY);
}

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
 * ciphertext JSON. Returns the public address.
 * @param {ethers.Wallet|ethers.HDNodeWallet} wallet
 * @param {string} password
 * @param {(pct:number)=>void} [onProgress]
 */
export async function encryptAndStore(wallet, password, onProgress) {
  const json = await wallet.encrypt(password, onProgress);
  localStorage.setItem(STORAGE_KEY, json);
  return wallet.address;
}

/**
 * Decrypt the stored keystore with the password and return a live Wallet. The
 * decrypted key lives only in the returned object for the duration of one signing
 * operation — the caller must not persist or transmit it.
 * @param {string} password
 * @param {(pct:number)=>void} [onProgress]
 * @returns {Promise<ethers.Wallet>}
 */
export async function unlockWallet(password, onProgress) {
  const json = localStorage.getItem(STORAGE_KEY);
  if (!json) throw new Error("No wallet on this device");
  return ethers.Wallet.fromEncryptedJson(json, password, onProgress);
}
