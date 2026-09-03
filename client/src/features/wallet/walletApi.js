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

/** Dollars spent on live swaps in the last 24 hours, across every chain. */
export async function fetchSpend24h() {
  const { data } = await http.get("/api/wallet/spend");
  return Number(data.spent24h) || 0;
}

/**
 * Tokens that arrived at this wallet which it had never been told about.
 * The server scans the chain first, so this is also what NOTICES an arrival.
 * Returns `{ tokens, sync }`; `sync.failed` means the chain could not be read
 * just now and the list may be behind, which the wallet says out loud.
 */
export async function fetchDiscoveredTokens(chainId) {
  const { data } = await http.get("/api/wallet/discovered", { params: { chainId } });
  return { tokens: data.tokens || [], sync: data.sync || {} };
}

/**
 * The owner's decision on a discovered token: `add` (to the custom list, with
 * the decimals its contract reported), `ignore`, or `restore`. Returns the
 * refreshed discovered list and the custom token list.
 */
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

/**
 * OPTIONAL extra verification before revealing wallet secrets.
 *
 * Only the PROMPTS cross the wire — never an answer hash, and never anything
 * derived from the wallet itself. The recovery phrase and private key are
 * decrypted in the browser and are not part of any request here or anywhere.
 */
export async function getSecurityQuestions() {
  const { data } = await http.get("/api/wallet/security");
  return data;
}

/** Enable or disable the extra layer. Answers are hashed server-side with bcrypt. */
export async function saveSecurityQuestions({ enabled, answers }) {
  const { data } = await http.put("/api/wallet/security", { enabled, answers });
  return data;
}

/**
 * Check the answers. Returns `{ verified }` rather than throwing on a mismatch,
 * so the caller can show the remaining-attempts message the server sends back.
 * The rate limit is enforced server-side, which is the only place it holds.
 */
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
