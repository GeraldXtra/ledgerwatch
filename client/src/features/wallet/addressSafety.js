const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function counterpartiesFrom(txs, own) {
  const mine = String(own || "").toLowerCase();
  const seen = new Map();
  for (const tx of txs || []) {
    for (const candidate of [tx && tx.to, tx && tx.from]) {
      const a = String(candidate || "");
      if (!ADDRESS_RE.test(a) || a.toLowerCase() === mine) continue;
      if (!seen.has(a.toLowerCase())) seen.set(a.toLowerCase(), a);
    }
  }
  return [...seen.values()];
}

export function lookalikeOf(candidate, known) {
  if (!ADDRESS_RE.test(String(candidate || ""))) return null;
  const c = candidate.toLowerCase();
  for (const k of known || []) {
    const a = String(k || "").toLowerCase();
    if (!ADDRESS_RE.test(a) || a === c) continue;
    if (a.slice(2, 6) === c.slice(2, 6) && a.slice(-4) === c.slice(-4)) return k;
  }
  return null;
}
