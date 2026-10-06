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
export async function fetchQuote({ debtId, chainId, tokenSymbol }) {
  const { data } = await http.get("/api/payment-addresses/quote", {
    // `tokenSymbol` is optional and was never sent, so every quote came back for
    // whichever stablecoin happened to be first in the registry for that chain
    // and the server's own USDT support was unreachable from the interface. The
    // server still defaults to the first when this is absent.
    params: tokenSymbol ? { debtId, chainId, tokenSymbol } : { debtId, chainId },
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

/**
 * Record the browser-derived address against the invoice.
 *
 * `tokenSymbol` is the stablecoin the payer will be told to send. It must be the
 * one the quote was priced in: the server validates it against the chain's
 * verified list and refuses anything else by name, so a mismatch is a refusal
 * rather than an address that quietly accepts a different token.
 */
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

/**
 * Record a sweep the browser has already signed and broadcast. Bookkeeping only
 * — the transaction is on chain before this is called, so a failure here must
 * never be reported to the user as a failed sweep.
 */
export async function recordSweep(id, { txHash, destination, amountUsdc, gasFundedTxHash }) {
  const { data } = await http.post(`/api/payment-addresses/${id}/sweeps`, {
    txHash,
    destination,
    amountUsdc,
    gasFundedTxHash,
  });
  return data;
}
