const PREFIX = "ledgerwatch.wallet.btc.pending";

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
  }
}

export function readLastSend(userId, evmAddress, network) {
  return read(userId, evmAddress, network, "last");
}

export function writeLastSend(userId, evmAddress, network, value) {
  write(userId, evmAddress, network, "last", value);
}

export function readAmbiguous(userId, evmAddress, network) {
  return read(userId, evmAddress, network, "ambiguous");
}

export function writeAmbiguous(userId, evmAddress, network, value) {
  write(userId, evmAddress, network, "ambiguous", value);
}

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
  }
}
