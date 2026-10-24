const { describeError } = require("./rpc.service");

const TIMEOUT_MS = Number(process.env.SOLANA_RPC_TIMEOUT_MS || 12000);
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

const TOKENS = {
  mainnet: [
    { symbol: "USDC", name: "USD Coin", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
    { symbol: "USDT", name: "Tether USD", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
  ],
  devnet: [{ symbol: "USDC", name: "USD Coin (devnet)", mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", decimals: 6 }],
};

function endpoints(network) {
  if (network === "devnet") return ["https://api.devnet.solana.com"];
  const custom = String(process.env.SOLANA_RPC_URL || "").trim();
  const list = [];
  if (/^https:\/\/[^\s]+$/.test(custom)) list.push(custom);
  list.push("https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com");
  return list;
}

function validateNetwork(network) {
  if (network !== "mainnet" && network !== "devnet") {
    return { ok: false, kind: "invalid", reason: 'Network must be either "mainnet" or "devnet".' };
  }
  return { ok: true, network };
}

function validateAddress(address, network) {
  const net = validateNetwork(network);
  if (!net.ok) return net;
  const a = typeof address === "string" ? address.trim() : "";
  if (!ADDRESS_RE.test(a)) return { ok: false, kind: "invalid", reason: "That is not a Solana address." };
  return { ok: true, address: a };
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "endpoint";
  }
}

async function rpc(network, method, params) {
  const list = endpoints(network);
  let last = null;
  for (let i = 0; i < list.length; i++) {
    let res;
    let body;
    try {
      res = await fetch(list[i], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      body = await res.json().catch(() => null);
    } catch (err) {
      const { code } = describeError(err);
      last = { ok: false, kind: "unreachable", reason: `Solana ${network} could not be reached (${code || "error"}).` };
      continue;
    }
    if (!res.ok || !body) {
      last = { ok: false, kind: "upstream", reason: `Solana ${network} answered HTTP ${res.status}.` };
      continue;
    }
    if (body.error) {
      const limited = body.error.code === 429 || /too many requests/i.test(String(body.error.message || ""));
      if (limited) {
        last = { ok: false, kind: "upstream", reason: `Solana ${network} is limiting requests from this server. Setting SOLANA_RPC_URL to a private endpoint lifts the limit.` };
        continue;
      }
      return { ok: false, kind: "rejected", reason: String(body.error.message || "The Solana node refused that request.").slice(0, 300), code: body.error.code };
    }
    if (i > 0) console.warn(`[solana] ${network}: ${hostOf(list[i])} served ${method} after ${i} failure(s)`);
    return { ok: true, result: body.result };
  }
  return last || { ok: false, kind: "unreachable", reason: `No Solana ${network} endpoint is configured.` };
}

async function getAccount(address, network) {
  const a = validateAddress(address, network);
  if (!a.ok) return a;
  const [bal, toks] = await Promise.all([
    rpc(network, "getBalance", [a.address, { commitment: "confirmed" }]),
    rpc(network, "getTokenAccountsByOwner", [a.address, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed", commitment: "confirmed" }]),
  ]);
  if (!bal.ok) return bal;
  const held = new Map();
  if (toks.ok) {
    for (const acct of (toks.result && toks.result.value) || []) {
      const info = acct.account && acct.account.data && acct.account.data.parsed && acct.account.data.parsed.info;
      if (!info || !info.mint || !info.tokenAmount) continue;
      const prev = held.get(info.mint) || 0n;
      held.set(info.mint, prev + BigInt(info.tokenAmount.amount || "0"));
    }
  }
  return {
    ok: true,
    network,
    address: a.address,
    lamports: String((bal.result && bal.result.value) || 0),
    tokens: TOKENS[network].map((t) => ({
      ...t,
      amount: toks.ok ? String(held.get(t.mint) || 0n) : null,
      error: toks.ok ? null : toks.reason,
    })),
  };
}

async function getBlockhash(network) {
  const net = validateNetwork(network);
  if (!net.ok) return net;
  const r = await rpc(network, "getLatestBlockhash", [{ commitment: "confirmed" }]);
  if (!r.ok) return r;
  const v = r.result && r.result.value;
  if (!v || !ADDRESS_RE.test(String(v.blockhash || ""))) return { ok: false, kind: "unparseable", reason: "The latest Solana blockhash could not be read." };
  return { ok: true, network, blockhash: v.blockhash, lastValidBlockHeight: Number(v.lastValidBlockHeight || 0) };
}

async function getRecipient(address, mint, network) {
  const a = validateAddress(address, network);
  if (!a.ok) return a;
  const known = mint ? TOKENS[network].find((t) => t.mint === mint) : null;
  if (mint && !known) return { ok: false, kind: "invalid", reason: "That token is not one this wallet sends on Solana." };
  const acct = await rpc(network, "getAccountInfo", [a.address, { encoding: "base64", commitment: "confirmed" }]);
  if (!acct.ok) return acct;
  const out = {
    ok: true,
    network,
    address: a.address,
    exists: Boolean(acct.result && acct.result.value),
    isProgram: Boolean(acct.result && acct.result.value && acct.result.value.executable),
    isTokenAccount: Boolean(acct.result && acct.result.value && acct.result.value.owner === TOKEN_PROGRAM),
  };
  if (known) {
    const toks = await rpc(network, "getTokenAccountsByOwner", [a.address, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }]);
    if (!toks.ok) return toks;
    out.hasTokenAccount = ((toks.result && toks.result.value) || []).length > 0;
  }
  const rent = await rpc(network, "getMinimumBalanceForRentExemption", [165]);
  out.tokenAccountRent = rent.ok ? Number(rent.result) : 2039280;
  const sysRent = await rpc(network, "getMinimumBalanceForRentExemption", [0]);
  out.accountRent = sysRent.ok ? Number(sysRent.result) : 890880;
  return out;
}

async function getPriorityFee(network) {
  const net = validateNetwork(network);
  if (!net.ok) return net;
  const r = await rpc(network, "getRecentPrioritizationFees", []);
  if (!r.ok) return { ok: true, network, microLamports: 0, estimated: false };
  const fees = ((r.result || []).map((f) => Number(f.prioritizationFee || 0)).filter((n) => Number.isFinite(n))).sort((a, b) => a - b);
  const median = fees.length ? fees[Math.floor(fees.length / 2)] : 0;
  return { ok: true, network, microLamports: Math.min(Math.max(median, 0), 5000000), estimated: true };
}

async function send(base64Tx, network) {
  const net = validateNetwork(network);
  if (!net.ok) return net;
  const tx = typeof base64Tx === "string" ? base64Tx.trim() : "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(tx) || tx.length < 100 || tx.length > 2000) {
    return { ok: false, kind: "invalid", reason: "That is not a signed Solana transaction." };
  }
  const r = await rpc(network, "sendTransaction", [tx, { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 5 }]);
  if (!r.ok) return r;
  if (!SIGNATURE_RE.test(String(r.result || ""))) return { ok: false, kind: "unparseable", reason: "The Solana node did not return a signature." };
  return { ok: true, network, signature: r.result };
}

async function getStatus(signature, network) {
  const net = validateNetwork(network);
  if (!net.ok) return net;
  if (!SIGNATURE_RE.test(String(signature || ""))) return { ok: false, kind: "invalid", reason: "That is not a Solana transaction signature." };
  const r = await rpc(network, "getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
  if (!r.ok) return r;
  const st = r.result && r.result.value && r.result.value[0];
  if (!st) return { ok: true, network, signature, found: false };
  return {
    ok: true,
    network,
    signature,
    found: true,
    confirmation: st.confirmationStatus || null,
    success: st.err == null,
    error: st.err ? JSON.stringify(st.err).slice(0, 200) : null,
  };
}

async function getHistory(address, network) {
  const a = validateAddress(address, network);
  if (!a.ok) return a;
  const sigs = await rpc(network, "getSignaturesForAddress", [a.address, { limit: 10 }]);
  if (!sigs.ok) return sigs;
  const items = [];
  for (const s of sigs.result || []) {
    const t = await rpc(network, "getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
    if (!t.ok || !t.result) {
      items.push({ signature: s.signature, at: s.blockTime ? s.blockTime * 1000 : null, success: s.err == null, changes: [] });
      continue;
    }
    const meta = t.result.meta || {};
    const keys = (t.result.transaction && t.result.transaction.message && t.result.transaction.message.accountKeys) || [];
    const idx = keys.findIndex((k) => (k.pubkey || k) === a.address);
    const changes = [];
    if (idx >= 0 && meta.preBalances && meta.postBalances) {
      const fee = idx === 0 ? Number(meta.fee || 0) : 0;
      const delta = Number(meta.postBalances[idx]) - Number(meta.preBalances[idx]) + fee;
      if (delta !== 0) changes.push({ symbol: "SOL", decimals: 9, delta: String(delta) });
    }
    for (const tok of TOKENS[network]) {
      const sum = (list) =>
        (list || [])
          .filter((b) => b.mint === tok.mint && b.owner === a.address)
          .reduce((n, b) => n + BigInt((b.uiTokenAmount && b.uiTokenAmount.amount) || "0"), 0n);
      const d = sum(meta.postTokenBalances) - sum(meta.preTokenBalances);
      if (d !== 0n) changes.push({ symbol: tok.symbol, decimals: tok.decimals, delta: d.toString() });
    }
    items.push({ signature: s.signature, at: s.blockTime ? s.blockTime * 1000 : null, success: s.err == null, fee: Number(meta.fee || 0), changes });
  }
  return { ok: true, network, address: a.address, items };
}

module.exports = { TOKENS, validateNetwork, validateAddress, getAccount, getBlockhash, getRecipient, getPriorityFee, send, getStatus, getHistory };
