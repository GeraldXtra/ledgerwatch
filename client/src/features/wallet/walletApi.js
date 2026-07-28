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

export async function updateTxStatus(id, status) {
  const { data } = await http.patch(`/api/wallet/txs/${id}`, { status });
  return data.tx;
}
