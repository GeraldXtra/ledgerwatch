import http from "../../api/http";

export async function fetchChains() {
  const { data } = await http.get("/api/wallet/chains");
  return data;
}

export async function saveAddress(address) {
  const { data } = await http.post("/api/wallet/address", { address });
  return data.walletAddress;
}

export async function clearAddress() {
  await http.delete("/api/wallet/address");
}

export async function fetchTxs(chainId) {
  const { data } = await http.get("/api/wallet/txs", { params: chainId ? { chainId } : {} });
  return data.txs;
}

export async function fetchSpend24h() {
  const { data } = await http.get("/api/wallet/spend");
  return Number(data.spent24h) || 0;
}

export async function fetchDiscoveredTokens(chainId) {
  const { data } = await http.get("/api/wallet/discovered", { params: { chainId } });
  return { tokens: data.tokens || [], sync: data.sync || {} };
}

export async function actOnDiscoveredToken({ chainId, address, action }) {
  const { data } = await http.post(
    `/api/wallet/discovered/${chainId}/${String(address).toLowerCase()}`,
    { action }
  );
  return { tokens: data.tokens || [], customTokens: data.customTokens || [] };
}

export async function recordTx(tx) {
  const { data } = await http.post("/api/wallet/txs", tx);
  return data.tx;
}

export async function saveCustomToken({ chainId, address, symbol, decimals }) {
  const { data } = await http.post("/api/trading/tokens", { chainId, address, symbol, decimals });
  return data.tokens;
}

export async function removeCustomToken({ chainId, address }) {
  const { data } = await http.delete("/api/trading/tokens", { data: { chainId, address } });
  return data.tokens;
}

export async function setTradingMode(mode) {
  const { data } = await http.patch("/api/trading/mode", { mode });
  return data.user;
}

export async function updateTxStatus(id, status) {
  const { data } = await http.patch(`/api/wallet/txs/${id}`, { status });
  return data.tx;
}

export async function getSecurityQuestions() {
  const { data } = await http.get("/api/wallet/security");
  return data;
}

export async function saveSecurityQuestions({ enabled, answers }) {
  const { data } = await http.put("/api/wallet/security", { enabled, answers });
  return data;
}

export async function verifySecurityAnswers(answers) {
  try {
    const { data } = await http.post("/api/wallet/security/verify", { answers });
    return data;
  } catch (err) {
    return {
      verified: false,
      error: err?.response?.data?.error || "Could not verify your answers.",
    };
  }
}
