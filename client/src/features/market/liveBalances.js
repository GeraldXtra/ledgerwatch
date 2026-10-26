import { CASH_CHOICES, cashChoiceOf, cashTokenFor } from "./tradeability";

const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

export function depositTokensFor(chain) {
  const out = [];
  for (const choice of CASH_CHOICES) {
    const t = cashTokenFor(chain, choice);
    if (t && cashChoiceOf(t) === choice && !out.some((x) => same(x.address, t.address))) out.push(t);
  }
  return out;
}

export function depositPhrase(tokens) {
  const symbols = tokens.map((t) => t.symbol);
  if (symbols.length === 0) return "a stablecoin";
  if (symbols.length === 1) return symbols[0];
  return `${symbols.slice(0, -1).join(", ")} or ${symbols[symbols.length - 1]}`;
}

function rank(row, deposit) {
  const d = deposit.findIndex((t) => !row.native && same(t.address, row.address));
  if (d >= 0) return d;
  if (row.native) return deposit.length;
  return deposit.length + 1;
}

export function visibleLiveRows(rows, chain) {
  const deposit = depositTokensFor(chain);
  return (rows || [])
    .filter((r) => r.unknown || (!r.native && deposit.some((t) => same(t.address, r.address))) || Number(r.qty) > 0)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r, deposit) - rank(b.r, deposit) || a.i - b.i)
    .map(({ r }) => r);
}

export function liveTotal(rows, priceFor) {
  const list = rows || [];
  let usd = 0;
  const unread = [];
  const unpriced = [];
  let readable = 0;
  for (const r of list) {
    if (r.unknown) {
      unread.push(r.symbol);
      continue;
    }
    readable += 1;
    const qty = Number(r.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const p = priceFor(r.symbol);
    if (!Number.isFinite(p)) {
      unpriced.push(r.symbol);
      continue;
    }
    usd += qty * p;
  }
  const allFailed = list.length > 0 && readable === 0;
  return { usd: allFailed ? null : usd, unread, unpriced, allFailed };
}

export function rowKey(row) {
  return row.native ? "native" : String(row.address || row.symbol).toLowerCase();
}
