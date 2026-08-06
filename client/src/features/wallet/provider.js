import { ethers } from "ethers";
import { getToken } from "../../api/http";

// All RPC goes through the authenticated backend proxy, so the Alchemy key is never
// exposed to the browser. ethers.JsonRpcProvider speaks standard JSON-RPC to the
// proxy URL; the proxy enforces a method allowlist and forwards upstream.
// 8000 matches the server's PORT, api/http.js and api/push.js. All three must
// agree: a split fallback silently sends wallet RPC to a different port than the
// rest of the app.
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function getProvider(chainId) {
  const req = new ethers.FetchRequest(`${API_BASE}/api/wallet/rpc/${chainId}`);
  const token = getToken();
  if (token) req.setHeader("Authorization", `Bearer ${token}`);
  // batchMaxCount: 1 keeps each proxied body a single JSON-RPC object.
  return new ethers.JsonRpcProvider(req, Number(chainId), {
    staticNetwork: true,
    batchMaxCount: 1,
  });
}

/**
 * Pull the human reason out of a failed RPC call.
 *
 * The proxy answers a dead upstream with 502 and a body naming what actually
 * went wrong — `{ chain, reason, code, endpointsTried }` — because "fetch failed"
 * on its own names nothing. ethers wraps that response several layers deep, so
 * this digs the body back out and falls back to its own message when the failure
 * came from somewhere else entirely.
 *
 * @returns {string|null} a short reason suitable for showing to the user
 */
export function rpcErrorReason(err) {
  if (!err) return null;

  const candidates = [
    err?.info?.response?.bodyText,
    err?.info?.responseBody,
    err?.response?.bodyText,
    err?.body,
  ];

  for (const raw of candidates) {
    if (typeof raw !== "string" || !raw.trim().startsWith("{")) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed.reason) {
        return parsed.chain ? `${parsed.chain}: ${parsed.reason}` : parsed.reason;
      }
      if (parsed.error) return parsed.error;
    } catch {
      // Not JSON after all — keep looking rather than throwing from an error handler.
    }
  }

  return err.shortMessage || err.message || null;
}

// Minimal ERC-20 ABI for balances + transfers.
export const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
];
