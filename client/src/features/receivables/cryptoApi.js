import http from "../../api/http";

export async function fetchChains() {
  const { data } = await http.get("/api/wallet/chains");
  return data.chains || [];
}

export async function fetchQuote({ debtId, chainId, tokenSymbol }) {
  const { data } = await http.get("/api/payment-addresses/quote", {
    params: tokenSymbol ? { debtId, chainId, tokenSymbol } : { debtId, chainId },
  });
  return data;
}

export async function allocateIndex(chainId) {
  const { data } = await http.post("/api/payment-addresses/allocate", { chainId });
  return data;
}

export async function createPaymentAddress({ debtId, chainId, address, derivationIndex, tokenSymbol }) {
  const { data } = await http.post("/api/payment-addresses", {
    debtId,
    chainId,
    address,
    derivationIndex,
    tokenSymbol,
  });
  return data;
}

export async function fetchPaymentAddresses(debtId) {
  const { data } = await http.get("/api/payment-addresses", {
    params: debtId ? { debtId } : {},
  });
  return data;
}

export async function revokePaymentAddress(id) {
  const { data } = await http.patch(`/api/payment-addresses/${id}/revoke`);
  return data;
}

export async function recordSweep(id, { txHash, destination, amountUsdc, gasFundedTxHash }) {
  const { data } = await http.post(`/api/payment-addresses/${id}/sweeps`, {
    txHash,
    destination,
    amountUsdc,
    gasFundedTxHash,
  });
  return data;
}
