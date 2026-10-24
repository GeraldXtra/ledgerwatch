const { describeError } = require("./rpc.service");

const TIMEOUT_MS = Number(process.env.TRON_API_TIMEOUT_MS || 12000);

const NETWORKS = {
  mainnet: {
    base: "https://api.trongrid.io",
    fallbacks: ["https://tron-rpc.publicnode.com", "https://api.tronstack.io"],
    explorer: "https://tronscan.org/#/transaction/",
    usdt: { address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", symbol: "USDT", decimals: 6 },
  },
  testnet: {
    base: "https://nile.trongrid.io",
    fallbacks: [],
    explorer: "https://nile.tronscan.org/#/transaction/",
    usdt: { address: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf", symbol: "USDT", decimals: 6 },
  },
};

const ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const TXID_RE = /^[0-9a-f]{64}$/;
const MAX_FEE_LIMIT_SUN = 100000000;

function apiKey() {
  const k = String(process.env.TRONGRID_API_KEY || "").trim();
  return /^[A-Za-z0-9._-]{16,256}$/.test(k) ? k : null;
}

function validateNetwork(network) {
  if (typeof network !== "string" || !NETWORKS[network]) {
    return { ok: false, kind: "invalid", reason: 'Network must be either "mainnet" or "testnet".' };
  }
  return { ok: true, network, config: NETWORKS[network] };
}

function validateAddress(address, network) {
  const net = validateNetwork(network);
  if (!net.ok) return net;
  const a = typeof address === "string" ? address.trim() : "";
  if (!ADDRESS_RE.test(a)) {
    return { ok: false, kind: "invalid", reason: "That is not a Tron address. A Tron address starts with T and is 34 characters long." };
  }
  return { ok: true, address: a };
}

const PRE_ACCEPT_CODES = ["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"];
const PRE_ACCEPT_STATUS = [401, 402, 403, 404, 405, 429];

async function call(network, path, opts = {}) {
  const { config } = validateNetwork(network);
  const bases = path.startsWith("/wallet/") ? [config.base, ...config.fallbacks] : [config.base];
  let last = null;
  for (let i = 0; i < bases.length; i++) {
    const r = await callOnce(bases[i], network, path, opts);
    if (r.ok) {
      if (i > 0) console.warn(`[tron] ${network}: ${new URL(bases[i]).host} served ${path} after ${i} failure(s)`);
      return r;
    }
    last = r;
    if (!r.preAccept) return r;
  }
  return last;
}

async function callOnce(base, network, path, { method = "GET", body, isBroadcast = false } = {}) {
  const headers = { Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (apiKey() && base === NETWORKS.mainnet.base) headers["TRON-PRO-API-KEY"] = apiKey();
  let res;
  let text;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    text = await res.text();
  } catch (err) {
    const { code, detail } = describeError(err);
    const preAccept = PRE_ACCEPT_CODES.includes(code);
    if (isBroadcast && !preAccept) {
      return {
        ok: false,
        kind: "ambiguous",
        reason: "The Tron network did not confirm whether it accepted this transaction. Check your activity before you try again, so you do not pay twice.",
      };
    }
    return { ok: false, preAccept: !isBroadcast || preAccept, kind: "unreachable", reason: `Tron ${network} could not be reached (${code || "error"}${detail ? `: ${detail}` : ""}).` };
  }
  if (!res.ok) {
    const preAccept = PRE_ACCEPT_STATUS.includes(res.status);
    if (isBroadcast && res.status === 400) {
      return { ok: false, kind: "rejected", reason: hexText(text) || `Tron ${network} refused the transaction.` };
    }
    if (isBroadcast && !preAccept) {
      return {
        ok: false,
        kind: "ambiguous",
        reason: "The Tron network did not confirm whether it accepted this transaction. Check your activity before you try again, so you do not pay twice.",
      };
    }
    return {
      ok: false,
      preAccept: !isBroadcast || preAccept,
      kind: "upstream",
      reason:
        res.status === 429
          ? network === "mainnet"
            ? `Tron ${network} is limiting requests from this server. Setting TRONGRID_API_KEY lifts the limit.`
            : `Tron ${network} is limiting requests from this server. Try again in a minute.`
          : `Tron ${network} answered HTTP ${res.status}.`,
    };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    if (isBroadcast) {
      return { ok: false, kind: "ambiguous", reason: "The Tron network answered in a way that could not be read. Check your activity before you try again." };
    }
    return { ok: false, kind: "unparseable", reason: "The Tron response was not valid JSON." };
  }
}

function hexText(hex) {
  try {
    return Buffer.from(String(hex || ""), "hex").toString("utf8").replace(/[^\x20-\x7e]/g, "").trim();
  } catch {
    return "";
  }
}

async function constant(network, owner, contract, selector, parameter = "") {
  const r = await call(network, "/wallet/triggerconstantcontract", {
    method: "POST",
    body: { owner_address: owner, contract_address: contract, function_selector: selector, parameter, visible: true },
  });
  if (!r.ok) return r;
  const v = r.value || {};
  if (!v.result || v.result.result !== true || !Array.isArray(v.constant_result)) {
    return { ok: false, kind: "upstream", reason: hexText(v.result && v.result.message) || "The token contract call failed." };
  }
  return { ok: true, hex: v.constant_result[0] || "", energy: Number(v.energy_used || 0) };
}

function addressParam(address) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const ch of address) n = n * 58n + BigInt(alphabet.indexOf(ch));
  const hex = n.toString(16).padStart(50, "0");
  return hex.slice(2, 42).padStart(64, "0");
}

async function getAccount(address, network) {
  const a = validateAddress(address, network);
  if (!a.ok) return a;
  const [acct, res] = await Promise.all([
    call(network, "/wallet/getaccount", { method: "POST", body: { address: a.address, visible: true } }),
    call(network, "/wallet/getaccountresource", { method: "POST", body: { address: a.address, visible: true } }),
  ]);
  if (!acct.ok) return acct;
  const v = acct.value || {};
  const exists = Boolean(v.address);
  const r = (res.ok && res.value) || {};
  const usdt = NETWORKS[network].usdt;
  const tok = await constant(network, usdt.address, usdt.address, "balanceOf(address)", addressParam(a.address));
  return {
    ok: true,
    address: a.address,
    network,
    exists,
    balanceSun: String(v.balance || 0),
    bandwidth: {
      free: Math.max(0, Number(r.freeNetLimit || 0) - Number(r.freeNetUsed || 0)),
      staked: Math.max(0, Number(r.NetLimit || 0) - Number(r.NetUsed || 0)),
    },
    energy: Math.max(0, Number(r.EnergyLimit || 0) - Number(r.EnergyUsed || 0)),
    tokens: [
      {
        ...usdt,
        balance: tok.ok ? BigInt(`0x${tok.hex || "0"}`).toString() : null,
        error: tok.ok ? null : tok.reason,
      },
    ],
  };
}

async function getBlock(network) {
  const net = validateNetwork(network);
  if (!net.ok) return net;
  const r = await call(network, "/wallet/getnowblock", { method: "POST", body: {} });
  if (!r.ok) return r;
  const b = r.value || {};
  const header = b.block_header && b.block_header.raw_data;
  if (!header || !TXID_RE.test(String(b.blockID || ""))) {
    return { ok: false, kind: "unparseable", reason: "The latest Tron block could not be read." };
  }
  return {
    ok: true,
    network,
    block: { blockID: b.blockID, block_header: { raw_data: { number: header.number, timestamp: header.timestamp } } },
  };
}

const paramsCache = new Map();
const PARAMS_TTL_MS = 10 * 60 * 1000;

async function getParams(network) {
  const net = validateNetwork(network);
  if (!net.ok) return net;
  const cached = paramsCache.get(network);
  if (cached && Date.now() - cached.at < PARAMS_TTL_MS) return cached.value;
  const value = await fetchParams(network);
  if (value.ok) paramsCache.set(network, { at: Date.now(), value });
  return value;
}

async function fetchParams(network) {
  const r = await call(network, "/wallet/getchainparameters");
  if (!r.ok) return r;
  const list = (r.value && r.value.chainParameter) || [];
  const get = (k) => {
    const hit = list.find((p) => p.key === k);
    return hit && Number.isFinite(Number(hit.value)) ? Number(hit.value) : null;
  };
  return {
    ok: true,
    network,
    energyFee: get("getEnergyFee"),
    bandwidthFee: get("getTransactionFee"),
    createAccountFee: get("getCreateNewAccountFeeInSystemContract"),
    createAccountBandwidthFee: get("getCreateAccountFee"),
  };
}

async function estimateTokenTransfer({ owner, to, amount, network }) {
  const a = validateAddress(owner, network);
  if (!a.ok) return a;
  const b = validateAddress(to, network);
  if (!b.ok) return b;
  if (!/^\d{1,30}$/.test(String(amount || ""))) return { ok: false, kind: "invalid", reason: "The amount is not a whole number of token units." };
  const usdt = NETWORKS[network].usdt;
  const param = addressParam(b.address) + BigInt(amount).toString(16).padStart(64, "0");
  const [sim, params] = await Promise.all([
    constant(network, a.address, usdt.address, "transfer(address,uint256)", param),
    getParams(network),
  ]);
  if (!sim.ok) return sim;
  if (!params.ok || !params.energyFee) return { ok: false, kind: "upstream", reason: "The Tron energy price could not be read." };
  const energy = Math.ceil(sim.energy * 1.2);
  const feeLimit = Math.min(MAX_FEE_LIMIT_SUN, Math.max(5000000, energy * params.energyFee));
  return { ok: true, network, energy, energyFee: params.energyFee, feeLimit, token: usdt };
}

async function broadcastHex(hex, network) {
  const net = validateNetwork(network);
  if (!net.ok) return net;
  const tx = typeof hex === "string" ? hex.trim().toLowerCase() : "";
  if (!/^([0-9a-f]{2}){60,4000}$/.test(tx)) return { ok: false, kind: "invalid", reason: "That is not a signed Tron transaction." };
  const r = await call(network, "/wallet/broadcasthex", { method: "POST", body: { transaction: tx }, isBroadcast: true });
  if (!r.ok) return r;
  const v = r.value || {};
  if (v.result === true && TXID_RE.test(String(v.txid || ""))) return { ok: true, network, txid: v.txid };
  const message = hexText(v.message) || v.Error || v.code || "The Tron network refused this transaction.";
  if (String(v.code || "") === "DUP_TRANSACTION_ERROR") {
    return { ok: true, network, txid: v.txid || null, duplicate: true };
  }
  return { ok: false, kind: "rejected", reason: String(message).slice(0, 300) };
}

async function getTxInfo(txid, network) {
  const net = validateNetwork(network);
  if (!net.ok) return net;
  if (!TXID_RE.test(String(txid || ""))) return { ok: false, kind: "invalid", reason: "A transaction id is 64 hexadecimal characters." };
  const r = await call(network, "/wallet/gettransactioninfobyid", { method: "POST", body: { value: txid } });
  if (!r.ok) return r;
  const v = r.value || {};
  if (!v.id) return { ok: true, network, txid, found: false };
  const result = (v.receipt && v.receipt.result) || (v.result === "FAILED" ? "FAILED" : "SUCCESS");
  return {
    ok: true,
    network,
    txid,
    found: true,
    blockNumber: Number(v.blockNumber || 0),
    success: result === "SUCCESS" && v.result !== "FAILED",
    result,
    feeSun: String(v.fee || 0),
  };
}

async function getHistory(address, network) {
  const a = validateAddress(address, network);
  if (!a.ok) return a;
  const usdt = NETWORKS[network].usdt;
  const [trx, tok] = await Promise.all([
    call(network, `/v1/accounts/${a.address}/transactions?limit=20&only_confirmed=false`),
    call(network, `/v1/accounts/${a.address}/transactions/trc20?limit=20&contract_address=${usdt.address}`),
  ]);
  if (!trx.ok && !tok.ok) return trx;
  const items = [];
  for (const t of (trx.ok && trx.value && trx.value.data) || []) {
    const c = t.raw_data && t.raw_data.contract && t.raw_data.contract[0];
    if (!c || c.type !== "TransferContract") continue;
    const value = c.parameter && c.parameter.value;
    if (!value) continue;
    items.push({
      txid: t.txID,
      symbol: "TRX",
      decimals: 6,
      amount: String(value.amount || 0),
      direction: String(value.to_address || "").toLowerCase() === hexOf(a.address) ? "in" : "out",
      counterparty: null,
      at: Number(t.block_timestamp || 0),
      success: !t.ret || !t.ret[0] || t.ret[0].contractRet === "SUCCESS",
    });
  }
  for (const t of (tok.ok && tok.value && tok.value.data) || []) {
    items.push({
      txid: t.transaction_id,
      symbol: (t.token_info && t.token_info.symbol) || "USDT",
      decimals: Number((t.token_info && t.token_info.decimals) || 6),
      amount: String(t.value || 0),
      direction: t.to === a.address ? "in" : "out",
      counterparty: t.to === a.address ? t.from : t.to,
      at: Number(t.block_timestamp || 0),
      success: true,
    });
  }
  items.sort((x, y) => y.at - x.at);
  return { ok: true, network, address: a.address, items: items.slice(0, 30), partial: !trx.ok || !tok.ok };
}

function hexOf(address) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const ch of address) n = n * 58n + BigInt(alphabet.indexOf(ch));
  return n.toString(16).padStart(50, "0").slice(0, 42);
}

module.exports = {
  NETWORKS,
  validateNetwork,
  validateAddress,
  getAccount,
  getBlock,
  getParams,
  estimateTokenTransfer,
  broadcastHex,
  getTxInfo,
  getHistory,
  addressParam,
  hexOf,
};
