import { ethers } from "ethers";
import { getToken } from "../../api/http";
import { API_BASE } from "../../api/base";

const READ_BATCH = 12;

export function getProvider(chainId, { batched = false } = {}) {
  const req = new ethers.FetchRequest(`${API_BASE}/api/wallet/rpc/${chainId}`);
  const token = getToken();
  if (token) req.setHeader("Authorization", `Bearer ${token}`);
  return new ethers.JsonRpcProvider(req, Number(chainId), {
    staticNetwork: true,
    batchMaxCount: batched ? READ_BATCH : 1,
    batchStallTime: batched ? 20 : 0,
  });
}

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
    }
  }

  return err.shortMessage || err.message || null;
}

export const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
];
