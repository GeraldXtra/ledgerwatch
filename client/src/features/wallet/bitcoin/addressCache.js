import { getStoredAddress } from "../keystore";

const PREFIX = "ledgerwatch.wallet.btc";

function keyFor(userId, evmAddress, network) {
  const who = userId || "anon";
  const keystore = String(evmAddress || "none").toLowerCase();
  return `${PREFIX}.${who}.${keystore}.${network}`;
}

const SHAPE = {
  mainnet: /^bc1q[ac-hj-np-z02-9]{38}$/,
  testnet: /^tb1q[ac-hj-np-z02-9]{38}$/,
};

export function isPlausibleBitcoinAddress(value, network) {
  const re = SHAPE[network];
  return Boolean(re) && typeof value === "string" && re.test(value);
}

export function readCachedBitcoinAddress(userId, network, evmAddress) {
  try {
    const evm = evmAddress || getStoredAddress();
    if (!evm) return null;
    const value = localStorage.getItem(keyFor(userId, evm, network));
    return isPlausibleBitcoinAddress(value, network) ? value : null;
  } catch {
    return null;
  }
}

export function cacheBitcoinAddress(userId, network, address, evmAddress) {
  try {
    const evm = evmAddress || getStoredAddress();
    if (!evm) return;
    if (!isPlausibleBitcoinAddress(address, network)) return;
    localStorage.setItem(keyFor(userId, evm, network), address);
  } catch {
  }
}

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
  }
}
