import { ethers } from "ethers";
import { unlockWallet } from "./keystore";

export const RECEIVABLES_BRANCH = "m/44'/60'/0'/2";

export function pathForIndex(index) {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid derivation index: ${index}`);
  }
  return `${RECEIVABLES_BRANCH}/${index}`;
}

export function canDerive(wallet) {
  return Boolean(wallet && wallet.mnemonic && wallet.mnemonic.phrase);
}

const CANNOT_DERIVE =
  "This wallet was imported from a private key, so it cannot derive payment addresses. Re-import it using your recovery phrase to enable crypto payments.";

export function deriveAddressFromWallet(master, index) {
  if (!canDerive(master)) throw new Error(CANNOT_DERIVE);
  const node = ethers.HDNodeWallet.fromPhrase(master.mnemonic.phrase, "", pathForIndex(index));
  return node.address;
}

export async function deriveAddress(password, index) {
  const master = await unlockWallet(password);
  return deriveAddressFromWallet(master, index);
}

export function deriveSignerFromWallet(master, index, provider) {
  if (!canDerive(master)) throw new Error(CANNOT_DERIVE);
  const node = ethers.HDNodeWallet.fromPhrase(master.mnemonic.phrase, "", pathForIndex(index));
  return provider ? node.connect(provider) : node;
}

export async function verifyAddress(password, index, expectedAddress) {
  const derived = await deriveAddress(password, index);
  return derived.toLowerCase() === String(expectedAddress).toLowerCase();
}
