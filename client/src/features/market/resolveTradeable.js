import http from "../../api/http";
import { tradeability, isCashToken } from "./tradeability";

export async function resolveTradeable({ chain, coin, customTokens = [], preferredCash }) {
  const local = tradeability(chain, coin, customTokens, preferredCash);

  if (local.code === "ok" && local.matchedBy === "symbol") {
    const checked = await verifyAgainstServer({ chain, coin, local });
    if (checked) return checked;
  }

  if (local.code !== "no-token") return local;

  let data;
  try {
    const res = await http.get("/api/trading/resolve", {
      params: { coinId: coin.coinId, chainId: chain.chainId },
    });
    data = res.data;
  } catch (err) {
    const detail = err?.response?.data?.error || err?.message || "the check could not be completed";
    return {
      ...local,
      code: "lookup-failed",
      reason: `${coin.symbol} could not be checked against ${chain.name} just now (${detail}). Nothing was assumed. Try again in a moment, or trade it on paper.`,
    };
  }

  if (!data || !data.ok || !data.token) {
    return { ...local, code: "no-token", reason: (data && data.reason) || local.reason };
  }

  if (isCashToken(data.token)) {
    return {
      live: false,
      code: "is-cash",
      reason: `${coin.symbol} is a dollar stablecoin, and live trades are funded in dollars. Buying it with ${local.cash?.symbol || "a dollar"} would only cost you the swap fee.`,
      token: data.token,
      cash: local.cash,
    };
  }

  return {
    live: true,
    code: "ok",
    reason: "",
    token: data.token,
    cash: local.cash,
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
    source: data.source || null,
  };
}

async function verifyAgainstServer({ chain, coin, local }) {
  let data;
  try {
    const res = await http.get("/api/trading/resolve", {
      params: { coinId: coin.coinId, chainId: chain.chainId },
    });
    data = res.data;
  } catch {
    return {
      ...local,
      warnings: [
        ...(local.warnings || []),
        `${coin.symbol} was matched to a verified ${chain.name} contract by its ticker alone, and ` +
          "that could not be double-checked just now. Tickers are not unique — confirm the address " +
          "below is the asset you mean before you sign.",
      ],
    };
  }

  if (!data || !data.ok || !data.token) return null;

  const same =
    String(data.token.address).toLowerCase() === String(local.token.address).toLowerCase();
  if (same) return { ...local, source: data.source || null };

  return {
    live: true,
    code: "ok",
    reason: "",
    token: data.token,
    cash: local.cash,
    warnings: [
      ...(Array.isArray(data.warnings) ? data.warnings : []),
      `${coin.symbol} shares its ticker with a different token already verified on ${chain.name}. ` +
        "The contract below is the one that matches the coin you are watching, not the one with the " +
        "same ticker. Check it before you sign.",
    ],
    source: data.source || null,
  };
}
