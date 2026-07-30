import http from "../../api/http";

// Thin wrappers over the payment-address endpoints. Only ever sends PUBLIC data:
// a derivation index and an address. No key or seed leaves the browser.

export async function fetchChains() {
  const { data } = await http.get("/api/wallet/chains");
  return data.chains || [];
}

/**
 * What issuing an address would ask for — balance, USDC amount, rate and the
 * rate's real age. Reserves nothing, so it is safe to call on every chain change.
 */
export async function fetchQuote({ debtId, chainId }) {
  const { data } = await http.get("/api/payment-addresses/quote", {
    params: { debtId, chainId },
  });
  return data;
}

/**
 * Reserve the next derivation index (atomic, server side) and get the chain,
 * token, confirmation depth and rate snapshot that go with it.
 *
 * NOTE: this permanently consumes an index, so callers should validate the user's
 * password FIRST — otherwise a typo burns one for nothing.
 */
export async function allocateIndex(chainId) {
  const { data } = await http.post("/api/payment-addresses/allocate", { chainId });
  return data;
}

/** Record the browser-derived address against the invoice. */
export async function createPaymentAddress({ debtId, chainId, address, derivationIndex }) {
  const { data } = await http.post("/api/payment-addresses", {
    debtId,
    chainId,
    address,
    derivationIndex,
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
