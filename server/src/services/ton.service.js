const { describeError } = require("./rpc.service");

const TIMEOUT_MS = Number(process.env.TON_API_TIMEOUT_MS || 12000);

const NETWORKS = {
  mainnet: {
    base: "https://toncenter.com",
    explorer: "https://tonviewer.com/",
    usdt: { symbol: "USDT", name: "Tether USD", master: "0:B113A994B5024A16719F69139328EB759596C38A25F59028B146FECDC3621DFE", decimals: 6 },
  },
  testnet: {
    base: "https://testnet.toncenter.com",
    explorer: "https://testnet.tonviewer.com/",
    usdt: null,
  },
};

const FRIENDLY_RE = /^[A-Za-z0-9_-]{48}$/;
const RAW_RE = /^-?[01]:[0-9a-fA-F]{64}$/;

function crc16(bytes) {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

function rawOf(address) {
  const a = String(address || "").trim();
  if (RAW_RE.test(a)) {
    const [wc, hash] = a.split(":");
    return `${Number(wc)}:${hash.toUpperCase()}`;
  }
  if (!FRIENDLY_RE.test(a)) return null;
  const bytes = Buffer.from(a.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (bytes.length !== 36) return null;
  const sum = (bytes[34] << 8) | bytes[35];
  if (crc16(bytes.subarray(0, 34)) !== sum) return null;
  const wc = bytes[1] === 0xff ? -1 : bytes[1];
  return `${wc}:${bytes.subarray(2, 34).toString("hex").toUpperCase()}`;
}

function apiKey(network) {
  const name = network === "testnet" ? "TONCENTER_TESTNET_API_KEY" : "TONCENTER_API_KEY";
  const k = String(process.env[name] || "").trim();
  return /^[A-Za-z0-9._-]{16,256}$/.test(k) ? k : null;
}

function validateNetwork(network) {
  if (!NETWORKS[network]) return { ok: false, kind: "invalid", reason: 'Network must be either "mainnet" or "testnet".' };
  return { ok: true, network, config: NETWORKS[network] };
}

function validateAddress(address, network) {
  const net = validateNetwork(network);
  if (!net.ok) return net;
  const a = typeof address === "string" ? address.trim() : "";
  if (!rawOf(a)) return { ok: false, kind: "invalid", reason: "That is not a TON address, or it has a typing mistake in it." };
  return { ok: true, address: a, raw: rawOf(a) };
}

let queue = Promise.resolve();
let lastAt = 0;

function spaced(network, fn) {
  const gap = apiKey(network) ? 120 : 1100;
  const run = queue.then(async () => {
    const wait = lastAt + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

async function call(network, path, opts = {}) {
  const first = await callOnce(network, path, opts);
  if (first.ok || !first.limited) return first;
  await new Promise((r) => setTimeout(r, 1500));
  return callOnce(network, path, opts);
}

async function callOnce(network, path, { method = "GET", body } = {}) {
  const { config } = validateNetwork(network);
  const headers = { Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (apiKey(network)) headers["X-API-Key"] = apiKey(network);
  return spaced(network, async () => {
    let res;
    let json;
    try {
      res = await fetch(`${config.base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS) });
      json = await res.json().catch(() => null);
    } catch (err) {
      const { code } = describeError(err);
      return { ok: false, kind: "unreachable", reason: `TON ${network} could not be reached (${code || "error"}).` };
    }
    if (res.status === 429) {
      return { ok: false, limited: true, kind: "upstream", reason: `TON ${network} is limiting requests from this server. Setting ${network === "testnet" ? "TONCENTER_TESTNET_API_KEY" : "TONCENTER_API_KEY"} lifts the limit.` };
    }
    if (!json) return { ok: false, kind: "upstream", reason: `TON ${network} answered HTTP ${res.status}.` };
    if (json.ok === false || (res.status >= 400 && !Array.isArray(json))) {
      const message = String(json.error || json.result || `HTTP ${res.status}`).slice(0, 300);
      return { ok: false, kind: res.status >= 500 ? "upstream" : "rejected", reason: message };
    }
    return { ok: true, value: json.result !== undefined ? json.result : json };
  });
}

async function jettonWallet(owner, network) {
  const usdt = NETWORKS[network].usdt;
  if (!usdt) return { ok: true, wallet: null };
  const r = await call(network, `/api/v3/jetton/wallets?owner_address=${encodeURIComponent(owner)}&jetton_address=${encodeURIComponent(usdt.master)}&limit=1`);
  if (!r.ok) return r;
  const w = ((r.value && r.value.jetton_wallets) || [])[0];
  if (!w) return { ok: true, wallet: null };
  if (String(w.jetton || "").toUpperCase() !== usdt.master.toUpperCase()) {
    return { ok: false, kind: "unparseable", reason: "The token wallet returned does not belong to USDT." };
  }
  return { ok: true, wallet: { address: w.address, balance: String(w.balance || "0") } };
}

async function getAccount(address, network) {
  const a = validateAddress(address, network);
  if (!a.ok) return a;
  const info = await call(network, `/api/v2/getWalletInformation?address=${encodeURIComponent(a.address)}`);
  if (!info.ok) return info;
  const v = info.value || {};
  const state = v.account_state || "uninit";
  if (state === "active" && v.wallet_type && v.wallet_type !== "wallet v4 r2") {
    return { ok: false, kind: "invalid", reason: `This address holds a ${v.wallet_type} wallet, not the v4R2 wallet this app signs for.` };
  }
  const usdt = NETWORKS[network].usdt;
  const jw = usdt ? await jettonWallet(a.address, network) : { ok: true, wallet: null };
  return {
    ok: true,
    network,
    address: a.address,
    nanotons: String(v.balance || "0"),
    state,
    deployed: state === "active",
    seqno: state === "active" ? Number(v.seqno || 0) : 0,
    tokens: usdt
      ? [
          {
            symbol: usdt.symbol,
            name: usdt.name,
            decimals: usdt.decimals,
            master: usdt.master,
            jettonWallet: jw.ok && jw.wallet ? jw.wallet.address : null,
            amount: jw.ok ? (jw.wallet ? jw.wallet.balance : "0") : null,
            error: jw.ok ? null : jw.reason,
          },
        ]
      : [],
  };
}

async function getRecipient(address, network) {
  const a = validateAddress(address, network);
  if (!a.ok) return a;
  const r = await call(network, `/api/v2/getAddressState?address=${encodeURIComponent(a.address)}`);
  if (!r.ok) return r;
  const state = String(r.value || "uninitialized");
  return { ok: true, network, address: a.address, state, active: state === "active" };
}

async function send(boc, network) {
  const net = validateNetwork(network);
  if (!net.ok) return net;
  const b = typeof boc === "string" ? boc.trim() : "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b) || b.length < 100 || b.length > 6000) {
    return { ok: false, kind: "invalid", reason: "That is not a signed TON message." };
  }
  const r = await call(network, "/api/v2/sendBocReturnHash", { method: "POST", body: { boc: b } });
  if (!r.ok && r.kind === "upstream" && !r.limited && !/answered HTTP|could not be reached/.test(r.reason)) {
    return { ok: false, kind: "rejected", reason: r.reason };
  }
  if (!r.ok) return r;
  return { ok: true, network, hash: (r.value && r.value.hash) || null };
}

async function getSeqno(address, network) {
  const a = validateAddress(address, network);
  if (!a.ok) return a;
  const info = await call(network, `/api/v2/getWalletInformation?address=${encodeURIComponent(a.address)}`);
  if (!info.ok) return info;
  const v = info.value || {};
  return { ok: true, network, deployed: v.account_state === "active", seqno: v.account_state === "active" ? Number(v.seqno || 0) : 0 };
}

function nano(n) {
  return String(n == null ? "0" : n);
}

async function getHistory(address, network) {
  const a = validateAddress(address, network);
  if (!a.ok) return a;
  const txs = await call(network, `/api/v2/getTransactions?address=${encodeURIComponent(a.address)}&limit=15&archival=true`);
  if (!txs.ok) return txs;
  const items = [];
  for (const t of Array.isArray(txs.value) ? txs.value : []) {
    const inValue = BigInt(nano(t.in_msg && t.in_msg.value));
    const outValue = (t.out_msgs || []).reduce((s, m) => s + BigInt(nano(m.value)), 0n);
    const delta = inValue - outValue;
    items.push({
      hash: t.transaction_id && t.transaction_id.hash,
      at: Number(t.utime || 0) * 1000,
      symbol: "TON",
      decimals: 9,
      delta: delta.toString(),
      fee: nano(t.fee),
      counterparty: delta >= 0n ? (t.in_msg && t.in_msg.source) || null : (t.out_msgs && t.out_msgs[0] && t.out_msgs[0].destination) || null,
    });
  }
  const usdt = NETWORKS[network].usdt;
  let partial = false;
  if (usdt) {
    const jt = await call(network, `/api/v3/jetton/transfers?owner_address=${encodeURIComponent(a.address)}&jetton_master=${encodeURIComponent(usdt.master)}&limit=15&sort=desc`);
    if (jt.ok) {
      for (const t of (jt.value && jt.value.jetton_transfers) || []) {
        const incoming = rawOf(t.destination) === a.raw;
        const outgoing = rawOf(t.source) === a.raw;
        if (!incoming && !outgoing) continue;
        items.push({
          hash: t.transaction_hash,
          at: Number(t.transaction_now || 0) * 1000,
          symbol: usdt.symbol,
          decimals: usdt.decimals,
          delta: (incoming ? "" : "-") + String(t.amount || "0"),
          counterparty: incoming ? t.source || null : t.destination || null,
          success: !t.transaction_aborted,
        });
      }
    } else {
      partial = true;
    }
  }
  items.sort((x, y) => y.at - x.at);
  return { ok: true, network, address: a.address, items: items.slice(0, 30), partial };
}

module.exports = { NETWORKS, rawOf, validateNetwork, validateAddress, getAccount, getRecipient, send, getSeqno, getHistory };
