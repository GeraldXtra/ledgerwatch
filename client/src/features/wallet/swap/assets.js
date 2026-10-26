const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

export function nativeAsset(chain) {
  const symbol = (chain && chain.nativeSymbol) || "ETH";
  return {
    key: `evm:${chain.chainId}:native`,
    symbol,
    name: symbol,
    decimals: 18,
    address: null,
    native: true,
    verified: true,
    custom: false,
  };
}

export function swapAssets(chain, tokens = []) {
  if (!chain) return [];
  const out = [nativeAsset(chain)];
  const listed = new Set((chain.tokens || []).map((t) => String(t.address || "").toLowerCase()));
  const seen = new Set();
  for (const t of tokens || []) {
    const addr = String(t.address || "").toLowerCase();
    if (!addr || seen.has(addr)) continue;
    seen.add(addr);
    const verified = listed.has(addr) && !t.custom;
    out.push({
      key: `evm:${chain.chainId}:${addr}`,
      symbol: t.symbol,
      name: t.name || t.symbol,
      decimals: Number(t.decimals),
      address: t.address,
      native: false,
      verified,
      custom: Boolean(t.custom),
      provenance: t.provenance || null,
      explorer: t.explorer || null,
    });
  }
  return out;
}

export function isWrappedNative(chain, asset) {
  const weth = chain && chain.wrappedNative;
  return Boolean(asset && !asset.native && weth && same(weth.address, asset.address));
}

export function sameAsset(a, b) {
  return Boolean(a && b && a.key === b.key);
}

export function assetBalance(asset, balances) {
  if (!asset) return null;
  const row = (balances || []).find((b) =>
    asset.native ? b.native : b.address ? same(b.address, asset.address) : same(b.symbol, asset.symbol)
  );
  if (!row || row.unknown || row.amount == null) return null;
  return Number(row.amount);
}

export function findAsset(assets, key) {
  return (assets || []).find((a) => a.key === key) || null;
}
