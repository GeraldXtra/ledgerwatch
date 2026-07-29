import { ethers } from "ethers";
import { unlockWallet } from "./keystore";

/**
 * HD derivation of invoice payment addresses — the security core of crypto
 * receivables.
 *
 * Path: m/44'/60'/0'/2/<index>
 *
 * BIP-44 uses change-level 0 for receive and 1 for change, so level 2 is a
 * branch no standard wallet touches. Importing this seed into MetaMask will
 * never surface or spend a receivables address, and our indices can never
 * shadow the user's own accounts.
 *
 * MUST match server/src/config/derivation.js exactly. If the two disagree, the
 * server watches an address the user cannot sign for, and funds sent to it are
 * unreachable.
 */

export const RECEIVABLES_BRANCH = "m/44'/60'/0'/2";

export function pathForIndex(index) {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid derivation index: ${index}`);
  }
  return `${RECEIVABLES_BRANCH}/${index}`;
}

/**
 * Can this wallet derive child addresses at all?
 *
 * A wallet imported from a bare private key has no mnemonic and no chain code,
 * so BIP-32 derivation is mathematically impossible for it — you cannot produce
 * children from a lone secp256k1 scalar. Callers must check this and show the
 * explanatory state rather than failing at signing time.
 */
export function canDerive(wallet) {
  return Boolean(wallet && wallet.mnemonic && wallet.mnemonic.phrase);
}

/**
 * Derive the invoice address for `index`, WITHOUT exposing the key.
 * Returns only the public address; the derived node is discarded on return.
 */
export async function deriveAddress(password, index) {
  const master = await unlockWallet(password);
  if (!canDerive(master)) {
    throw new Error(
      "This wallet was imported from a private key, so it cannot derive payment addresses. Re-import it using your recovery phrase to enable crypto payments."
    );
  }
  const node = ethers.HDNodeWallet.fromPhrase(master.mnemonic.phrase, "", pathForIndex(index));
  return node.address;
}

/**
 * Derive a SIGNER for `index`, connected to a provider. Used only for sweeping,
 * which is an outbound transaction and therefore always user-approved.
 *
 * The returned wallet holds a live private key: use it for one operation and let
 * it go out of scope. Never store it, never log it, never put it in a request.
 */
export async function deriveSigner(password, index, provider) {
  const master = await unlockWallet(password);
  if (!canDerive(master)) {
    throw new Error(
      "This wallet cannot derive payment addresses. Re-import it using your recovery phrase."
    );
  }
  const node = ethers.HDNodeWallet.fromPhrase(master.mnemonic.phrase, "", pathForIndex(index));
  return provider ? node.connect(provider) : node;
}

/**
 * Verify that a server-issued address really belongs to this seed at this index
 * before it is shown to a payer. Catches any drift between the client and server
 * derivation policies — money sent to a mismatched address would be unreachable.
 */
export async function verifyAddress(password, index, expectedAddress) {
  const derived = await deriveAddress(password, index);
  return derived.toLowerCase() === String(expectedAddress).toLowerCase();
}
