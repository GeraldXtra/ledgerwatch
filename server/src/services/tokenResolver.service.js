const { getChain, tokensFor } = require("../config/chains");
const { readTokenMeta, impersonationOf } = require("./walletHistory.service");
const cg = require("./coingecko.service");

const RESOLVE_TTL = 6 * 60 * 60 * 1000;

const REFUSAL_TTL = 60 * 1000;

const cache = new Map();

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function refuse(reason, extra = {}) {
  return { ok: false, reason, token: null, ...extra };
}

function cacheKey(coinId, chainId) {
  return `${String(coinId).toLowerCase()}:${Number(chainId)}`;
}

function readCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  const ttl = entry.ok ? RESOLVE_TTL : REFUSAL_TTL;
  if (Date.now() - entry.ts > ttl) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

const MAX_CACHE_ENTRIES = 5000;

function writeCache(key, data) {
  cache.delete(key);
  cache.set(key, { data, ts: Date.now(), ok: data.ok === true });
  if (cache.size <= MAX_CACHE_ENTRIES) return;

  const now = Date.now();
  for (const [k, entry] of cache) {
    if (now - entry.ts > (entry.ok ? RESOLVE_TTL : REFUSAL_TTL)) cache.delete(k);
  }
  for (const k of cache.keys()) {
    if (cache.size <= MAX_CACHE_ENTRIES) break;
    cache.delete(k);
  }
}

async function resolveCoinOnChain({ coinId, chainId }) {
  const id = String(coinId || "").trim().toLowerCase();
  const numericChainId = Number(chainId);
  if (!id) return refuse("No coin was given.");
  if (!Number.isInteger(numericChainId)) return refuse("No network was given.");

  const key = cacheKey(id, numericChainId);
  const hit = readCache(key);
  if (hit) return hit;

  const result = await doResolve(id, numericChainId);
  writeCache(key, result);
  return result;
}

async function doResolve(id, chainId) {
  const chain = getChain(chainId);
  if (!chain) {
    return refuse("That network is not available, so nothing can be traded on it here.");
  }

  const { platforms, byChainId, available } = await cg.getAssetPlatforms();
  if (!available) {
    return refuse(
      "The coin index could not be reached just now, so which token contracts exist on " +
        `${chain.name} could not be confirmed. Nothing was assumed. Try again shortly.`
    );
  }
  const platformId = byChainId[chainId] || null;
  if (!platformId) {
    return refuse(
      `The coin index does not list ${chain.name} as a network it carries token addresses for, ` +
        `so a contract there cannot be confirmed. Trade this one on paper.`
    );
  }
  const platform = platforms[platformId] || null;

  if (platform && platform.nativeCoinId && platform.nativeCoinId === id) {
    if (!chain.wrappedNative) {
      return refuse(
        `${chain.name} has no verified wrapped ${chain.nativeSymbol} in the registry, and an ` +
          `exchange cannot hand back a native coin. Trade this one on paper.`
      );
    }
    return {
      ok: true,
      source: "registry-wrapped-native",
      token: {
        ...chain.wrappedNative,
        contractReadable: true,
        provenance: "registry",
        chainId: chain.chainId,
      },
      warnings: [],
    };
  }

  const coin = await cg.getCoinPlatforms(id);
  if (!coin) {
    return refuse(
      "The coin index could not be reached just now, so this token's contract address could not " +
        "be confirmed. Nothing was assumed. Try again shortly."
    );
  }
  if (coin.notFound) {
    return refuse(`The coin index has no record of "${id}", so there is no contract to look up.`);
  }

  const claim = coin.platforms[platformId] || null;
  if (!claim) {
    return refuse(
      `${coin.symbol || id} has no contract on ${chain.name} according to the coin index, so ` +
        `there is nothing to trade there. It may exist on another network.`
    );
  }

  const address = claim.address;
  if (!ADDRESS_RE.test(address)) {
    return refuse(
      `The address the coin index gives for ${coin.symbol || id} on ${chain.name} is not an ` +
        `Ethereum-style address, so it cannot be used here.`
    );
  }
  const lower = address.toLowerCase();

  const registryHit = tokensFor(chain).find((t) => String(t.address).toLowerCase() === lower);
  if (registryHit) {
    return {
      ok: true,
      source: "registry",
      token: { ...registryHit, contractReadable: true, provenance: "registry", chainId: chain.chainId },
      warnings: [],
    };
  }

  const meta = await readTokenMeta(chain, address);
  if (meta.transport || (!meta.readable && meta.anyMissing)) {
    return refuse(
      `${chain.name} could not be reached to confirm this token's contract, so it was not ` +
        `accepted. Nothing was assumed about it. Try again shortly.`
    );
  }
  if (!meta.readable) {
    return refuse(
      `The contract at ${address} on ${chain.name} does not report a symbol and decimals the ` +
        `way a token must, so it cannot be traded or displayed correctly here.`
    );
  }

  if (claim.decimals != null && claim.decimals !== meta.decimals) {
    return refuse(
      `The coin index says ${coin.symbol || id} on ${chain.name} uses ${claim.decimals} decimals ` +
        `and the contract at ${address} reports ${meta.decimals}. Those disagree, so this was ` +
        `refused rather than guessed: trading on the wrong decimals moves the wrong amount.`
    );
  }

  const warnings = [];

  const onChainUpper = String(meta.symbol || "").toUpperCase();
  const registryClash = tokensFor(chain).find(
    (t) => String(t.symbol).toUpperCase() === onChainUpper && String(t.address).toLowerCase() !== lower
  );
  if (registryClash) {
    return refuse(
      `The contract at ${address} on ${chain.name} calls itself ${meta.symbol}, but the verified ` +
        `${registryClash.symbol} on this network is at ${registryClash.address}. Two contracts ` +
        `cannot both be ${registryClash.symbol}, so this one was refused. Trade the verified one, ` +
        `or add this contract by address in the wallet if you are certain of it.`
    );
  }

  const wellKnown = impersonationOf(meta.symbol, chain);
  if (wellKnown) {
    warnings.push(
      `${meta.symbol} is a well known name, and this contract is not the one this app verified ` +
        `for ${chain.name}. That is normal for a bridged version, and it is also what an ` +
        `imitation looks like. Check the address.`
    );
  }

  const claimedSymbol = String(coin.symbol || "").toUpperCase();
  const onChainSymbol = String(meta.symbol || "").toUpperCase();
  if (claimedSymbol && onChainSymbol && claimedSymbol !== onChainSymbol) {
    warnings.push(
      `The contract calls itself ${meta.symbol}, while the coin is listed as ${coin.symbol}. ` +
        `That is normal for bridged and wrapped versions, but check the address before trading.`
    );
  }

  return {
    ok: true,
    source: "coingecko-verified",
    token: {
      symbol: meta.symbol,
      name: meta.name || coin.name || meta.symbol,
      address,
      decimals: meta.decimals,
      contractReadable: true,
      provenance: "coingecko",
      coinId: id,
      chainId: chain.chainId,
      explorer: chain.explorer ? `${chain.explorer}/token/${address}` : null,
    },
    warnings,
  };
}

function _clearCache() {
  cache.clear();
}

module.exports = { resolveCoinOnChain, _clearCache, RESOLVE_TTL, REFUSAL_TTL };
