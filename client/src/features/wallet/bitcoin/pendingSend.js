/**
 * THE UNRESOLVED BITCOIN SEND, KEPT ACROSS RELOADS.
 *
 * Two pieces of state in BitcoinPanel were held in component memory only:
 *
 *   `ambiguous` — a broadcast whose outcome the network never confirmed. While
 *   it is set, the panel refuses to sign anything else until the person has
 *   looked for the transaction, because reporting that outcome as a plain error
 *   is how a payment got sent twice. Bitcoin transfers are irreversible.
 *
 *   `lastSend` — the transaction the Speed up and Cancel buttons act on. Losing
 *   it removes the only route this app offers for un-sticking a payment that is
 *   sitting in the mempool at too low a fee.
 *
 * Both were destroyed by a page reload, and a reload is the single most likely
 * thing somebody does after seeing an alarming message: the form came back
 * enabled, with nothing on screen recording that an unresolved payment existed.
 * A guard that a refresh removes is not a guard, so they live in localStorage,
 * keyed exactly like the Bitcoin address cache — account, keystore address and
 * network — so a different phrase or a different network can never be shown
 * another one's pending send.
 *
 * Storage is treated as best effort throughout. Private mode and a full store
 * both mean the panel simply behaves as it did before this file existed, and
 * that must never be a thrown error on a money path.
 */

const PREFIX = "ledgerwatch.wallet.btc.pending";

// A pending send that nobody has resolved in a month is not something the panel
// can still act on: the fee-bump inputs are long spent or long confirmed. Kept
// generously long, because the cost of showing a stale warning is a moment's
// confusion and the cost of dropping a live one is a double payment.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function keyFor(userId, evmAddress, network, slot) {
  const who = userId || "anon";
  const keystore = String(evmAddress || "none").toLowerCase();
  return `${PREFIX}.${slot}.${who}.${keystore}.${network}`;
}

function read(userId, evmAddress, network, slot) {
  try {
    const raw = localStorage.getItem(keyFor(userId, evmAddress, network, slot));
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    // Belt and braces on top of the key: a record that names another network is
    // never handed back, whatever it was filed under.
    if (value.network && value.network !== network) return null;
    if (value.at && Date.now() - Number(value.at) > MAX_AGE_MS) return null;
    return value;
  } catch {
    return null;
  }
}

function write(userId, evmAddress, network, slot, value) {
  try {
    const key = keyFor(userId, evmAddress, network, slot);
    if (!value) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ ...value, network, at: value.at || Date.now() }));
  } catch {
    /* not being able to remember it leaves the pre-existing behaviour */
  }
}

/** The last transaction this panel broadcast on this network, if any. */
export function readLastSend(userId, evmAddress, network) {
  return read(userId, evmAddress, network, "last");
}

export function writeLastSend(userId, evmAddress, network, value) {
  write(userId, evmAddress, network, "last", value);
}

/** A broadcast whose outcome is still unknown. Blocks sending while it is set. */
export function readAmbiguous(userId, evmAddress, network) {
  return read(userId, evmAddress, network, "ambiguous");
}

export function writeAmbiguous(userId, evmAddress, network, value) {
  write(userId, evmAddress, network, "ambiguous", value);
}

/**
 * Forget everything remembered for an account, both networks. Called wherever
 * the wallet on this device is removed or replaced, alongside the address
 * cache: a pending send belongs to a keystore that is no longer here.
 */
export function clearPendingSends(userId) {
  try {
    const marker = `.${userId || "anon"}.`;
    const dead = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX) && k.includes(marker)) dead.push(k);
    }
    dead.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage unavailable: nothing was remembered to begin with */
  }
}
