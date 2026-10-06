import { ethers } from "ethers";
import { getToken } from "../../api/http";

const BASE_KEY = "ledgerwatch.wallet.keystore";

const LEGACY_KEY = BASE_KEY;

function activeUserId() {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const id = JSON.parse(json).id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

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

function addressFromKeystore(json) {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed.address ? ethers.getAddress("0x" + parsed.address.replace(/^0x/, "")) : null;
  } catch {
    return null;
  }
}

export function getStoredAddress() {
  return addressFromKeystore(readKeystore());
}

export function clearWallet() {
  const key = activeStorageKey();
  if (key) localStorage.removeItem(key);
}

export function getLegacyWallet() {
  const json = localStorage.getItem(LEGACY_KEY);
  if (!json) return null;
  const address = addressFromKeystore(json);
  return address ? { address } : null;
}

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

export function discardLegacyWallet() {
  localStorage.removeItem(LEGACY_KEY);
}

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

export async function encryptAndStore(wallet, password, onProgress) {
  const key = activeStorageKey();
  if (!key) throw new Error("You need to be signed in to save a wallet.");
  const json = await wallet.encrypt(password, onProgress);
  localStorage.setItem(key, json);
  return wallet.address;
}

export async function unlockWallet(password, onProgress) {
  const json = readKeystore();
  if (!json) throw new Error("No wallet on this device for this account");
  return ethers.Wallet.fromEncryptedJson(json, password, onProgress);
}

export async function revealSecrets(password, onProgress) {
  const wallet = await unlockWallet(password, onProgress);
  return {
    address: wallet.address,
    mnemonic: wallet.mnemonic ? wallet.mnemonic.phrase : null,
    privateKey: wallet.privateKey,
  };
}

export async function importFromKeystore(json, password, onProgress) {
  const text = typeof json === "string" ? json.trim() : "";
  if (!text) throw new Error("Paste or upload the keystore JSON file.");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That is not valid JSON. Upload the keystore file you downloaded.");
  }
  if (!parsed || !parsed.Crypto && !parsed.crypto) {
    throw new Error("That JSON is not an encrypted keystore. It has no Crypto section.");
  }
  const wallet = await ethers.Wallet.fromEncryptedJson(text, password, onProgress);
  return { wallet, address: wallet.address };
}

const BACKUP_KEY = "ledgerwatch.wallet.backedUp";

export function isBackedUp() {
  const address = getStoredAddress();
  if (!address) return true;
  try {
    return localStorage.getItem(`${BACKUP_KEY}.${address.toLowerCase()}`) === "1";
  } catch {
    return true;
  }
}

export function markBackedUp() {
  const address = getStoredAddress();
  if (!address) return;
  try {
    localStorage.setItem(`${BACKUP_KEY}.${address.toLowerCase()}`, "1");
  } catch {
  }
}
