import { ethers } from "ethers";
import { getToken } from "../../api/http";

// All RPC goes through the authenticated backend proxy, so the Alchemy key is never
// exposed to the browser. ethers.JsonRpcProvider speaks standard JSON-RPC to the
// proxy URL; the proxy enforces a method allowlist and forwards upstream.
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

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

// Minimal ERC-20 ABI for balances + transfers.
export const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
];
