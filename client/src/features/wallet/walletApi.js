import http from "../../api/http";

// Thin wrappers over the wallet backend. Only ever sends PUBLIC data.
export async function fetchChains() {
  const { data } = await http.get("/api/wallet/chains");
  return data; // { chains, enableMainnet }
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

export async function recordTx(tx) {
  const { data } = await http.post("/api/wallet/txs", tx);
  return data.tx;
}

/**
 * Persist a user-added ERC-20. `decimals` must be the value read from the
 * contract — the server validates the range but cannot know the true value.
 */
export async function saveCustomToken({ chainId, address, symbol, decimals }) {
  const { data } = await http.post("/api/trading/tokens", { chainId, address, symbol, decimals });
  return data.tokens;
}

export async function removeCustomToken({ chainId, address }) {
  const { data } = await http.delete("/api/trading/tokens", { data: { chainId, address } });
  return data.tokens;
}

/** Switch between paper and live trading. Server rejects live for the demo account. */
export async function setTradingMode(mode) {
  const { data } = await http.patch("/api/trading/mode", { mode });
  return data.user;
}

export async function updateTxStatus(id, status) {
  const { data } = await http.patch(`/api/wallet/txs/${id}`, { status });
  return data.tx;
}
