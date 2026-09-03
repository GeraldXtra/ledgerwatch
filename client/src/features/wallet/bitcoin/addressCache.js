import { getStoredAddress } from "../keystore";

/**
 * WHERE THE BITCOIN RECEIVE ADDRESS IS REMEMBERED, AND WHY THE KEY IS SHAPED
 * THE WAY IT IS.
 *
 * The address is public and deriving it needs the password, so it is cached so
 * that opening the wallet does not demand a password just to show a balance.
 *
 * THE DEFECT THIS REPLACES. The cache used to be keyed on the account and the
 * network only. Nothing about the KEYSTORE was in the key, and nothing ever
 * cleared it. So: create wallet A, unlock Bitcoin once, `bc1qA` is cached. Later
 * remove that wallet and import a different phrase, wallet B, into the same
 * account. Open Bitcoin: the cache still says `bc1qA`, the setup screen is
 * skipped, the Receive drawer shows `bc1qA`, and a customer pays an address
 * this browser can no longer sign for. If phrase A was never written down the
 * coins are gone. The balance shown was A's too, so nothing on screen argued.
 *
 * THE FIX IS THE KEY. The keystore's own EVM address is part of it, so a
 * different phrase is a different keystore is a different address is a
 * different cache slot, and the panel asks for the password again. That is the
 * same discipline `BACKUP_KEY` in keystore.js already applies, and it holds
 * even if a caller forgets to clear anything. Clearing on remove and import is
 * done as well, so stale entries do not pile up in storage.
 *
 * A cached value is also checked for shape on the way out. A P2WPKH address on
 * the requested network is 42 characters with a fixed prefix; anything else in
 * that slot is treated as absent rather than displayed.
 */

const PREFIX = "ledgerwatch.wallet.btc";

function keyFor(userId, evmAddress, network) {
  const who = userId || "anon";
  const keystore = String(evmAddress || "none").toLowerCase();
  return `${PREFIX}.${who}.${keystore}.${network}`;
}

/** Bech32 body: no 1, b, i or o. P2WPKH is exactly 38 characters after the hrp. */
const SHAPE = {
  mainnet: /^bc1q[ac-hj-np-z02-9]{38}$/,
  testnet: /^tb1q[ac-hj-np-z02-9]{38}$/,
};

export function isPlausibleBitcoinAddress(value, network) {
  const re = SHAPE[network];
  return Boolean(re) && typeof value === "string" && re.test(value);
}

/**
 * @param {string} userId
 * @param {"mainnet"|"testnet"} network
 * @param {string|null} [evmAddress]  the keystore's address; read from the
 *        keystore when omitted
 */
export function readCachedBitcoinAddress(userId, network, evmAddress) {
  try {
    const evm = evmAddress || getStoredAddress();
    // No keystore on this device means no address can belong to it.
    if (!evm) return null;
    const value = localStorage.getItem(keyFor(userId, evm, network));
    return isPlausibleBitcoinAddress(value, network) ? value : null;
  } catch {
    return null; // private mode: we simply derive again
  }
}

export function cacheBitcoinAddress(userId, network, address, evmAddress) {
  try {
    const evm = evmAddress || getStoredAddress();
    if (!evm) return;
    if (!isPlausibleBitcoinAddress(address, network)) return;
    localStorage.setItem(keyFor(userId, evm, network), address);
  } catch {
    /* not being able to remember it is a nuisance, not a failure */
  }
}

/**
 * Forget every cached Bitcoin address for an account, including entries written
 * by the previous key format. Called when the wallet on this device is removed
 * or replaced, so the next visit to the Bitcoin panel derives afresh.
 */
export function clearBitcoinAddressCache(userId) {
  try {
    const prefix = `${PREFIX}.${userId || "anon"}.`;
    const dead = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) dead.push(k);
    }
    dead.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage unavailable: nothing was cached to begin with */
  }
}
