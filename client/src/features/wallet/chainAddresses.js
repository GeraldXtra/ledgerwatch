import http from "../../api/http";

const PREFIX = "ledgerwatch.wallet.addr";

function keyFor(userId, chain, network) {
  return `${PREFIX}.${chain}.${network}.${userId || "anon"}`;
}

export function readChainAddress(userId, chain, network, evmAddress) {
  try {
    const raw = localStorage.getItem(keyFor(userId, chain, network));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved.address !== "string") return null;
    if (evmAddress && saved.evm && saved.evm.toLowerCase() !== String(evmAddress).toLowerCase()) return null;
    return saved.address;
  } catch {
    return null;
  }
}

export function cacheChainAddress(userId, chain, network, address, evmAddress) {
  try {
    localStorage.setItem(keyFor(userId, chain, network), JSON.stringify({ address, evm: evmAddress || null, at: Date.now() }));
  } catch {
    return;
  }
}

export function clearChainAddresses(userId) {
  try {
    const suffix = `.${userId || "anon"}`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`${PREFIX}.`) && k.endsWith(suffix)) localStorage.removeItem(k);
    }
  } catch {
    return;
  }
}

export async function registerChainAddress(chain, network, address) {
  try {
    await http.post("/api/wallet/chain-addresses", { chain, network, address });
    return true;
  } catch {
    return false;
  }
}

const registered = new Set();

export function ensureChainAddressRegistered(chain, network, address) {
  const key = `${chain}:${network}:${address}`;
  if (!address || registered.has(key)) return Promise.resolve(true);
  registered.add(key);
  return registerChainAddress(chain, network, address).then((ok) => {
    if (!ok) registered.delete(key);
    return ok;
  });
}
