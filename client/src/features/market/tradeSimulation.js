import { ethers } from "ethers";
import { ERC20_ALLOWANCE_ABI, buildSwapTx } from "./dex";
import { rpcErrorReason } from "../wallet/provider";

const erc20 = new ethers.Interface(ERC20_ALLOWANCE_ABI);

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

function call(from, to, data) {
  return { from, to, data };
}

function revertDetail(result) {
  const message = result && result.error && result.error.message;
  if (!message) return "it reverted";
  const trimmed = String(message).replace(/^execution reverted:?\s*/i, "").trim();
  return trimmed || "it reverted";
}

function balanceIn(result) {
  if (!result || result.status !== "0x1") return null;
  const data = result.returnData;
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(data)) return null;
  return BigInt(data);
}

export function isVerifiedToken(chain, token) {
  return Boolean(token && (chain?.tokens || []).some((t) => same(t.address, token.address)));
}

export async function simulateTrade({
  provider,
  chain,
  from,
  tokenIn,
  tokenOut,
  amountIn,
  amountOutMinimum,
  swapTx,
  quote,
  needsApproval,
  sellBack,
}) {
  const router = chain.dex.router;
  const calls = [];
  const at = {};
  const push = (name, c) => {
    at[name] = calls.length;
    calls.push(c);
  };

  if (needsApproval) push("approve", call(from, tokenIn.address, erc20.encodeFunctionData("approve", [router, amountIn])));
  push("outBefore", call(from, tokenOut.address, erc20.encodeFunctionData("balanceOf", [from])));
  push("swap", call(from, swapTx.to, swapTx.data));
  push("outAfter", call(from, tokenOut.address, erc20.encodeFunctionData("balanceOf", [from])));

  const sellAmount = sellBack && amountOutMinimum > 0n ? amountOutMinimum : null;
  if (sellAmount != null) {
    const reverse = {
      route: { tokens: [...quote.route.tokens].reverse(), fees: [...quote.route.fees].reverse() },
    };
    const sellTx = buildSwapTx({
      chain,
      quote: reverse,
      amountIn: sellAmount,
      amountOutMinimum: 0n,
      recipient: from,
      tokenIn: tokenOut.address,
      tokenOut: tokenIn.address,
    });
    push("sellApprove", call(from, tokenOut.address, erc20.encodeFunctionData("approve", [router, sellAmount])));
    push("inBefore", call(from, tokenIn.address, erc20.encodeFunctionData("balanceOf", [from])));
    push("sell", call(from, sellTx.to, sellTx.data));
    push("inAfter", call(from, tokenIn.address, erc20.encodeFunctionData("balanceOf", [from])));
  }

  let blocks;
  try {
    blocks = await provider.send("eth_simulateV1", [{ blockStateCalls: [{ calls }], validation: false }, "latest"]);
  } catch (err) {
    return { checked: false, reason: rpcErrorReason(err) || "the simulation could not run" };
  }

  const results = Array.isArray(blocks) && blocks[0] && Array.isArray(blocks[0].calls) ? blocks[0].calls : null;
  if (!results || results.length !== calls.length) {
    return { checked: false, reason: "the network's answer to the simulation was incomplete" };
  }

  if (at.approve != null && results[at.approve].status !== "0x1") {
    return { checked: true, ok: false, kind: "approval-fails", detail: revertDetail(results[at.approve]) };
  }
  if (results[at.swap].status !== "0x1") {
    return { checked: true, ok: false, kind: "swap-fails", detail: revertDetail(results[at.swap]) };
  }

  const outBefore = balanceIn(results[at.outBefore]);
  const outAfter = balanceIn(results[at.outAfter]);
  if (outBefore == null || outAfter == null) {
    return { checked: false, reason: `${tokenOut.symbol}'s balance could not be read in the simulation` };
  }
  const received = outAfter - outBefore;
  if (received < amountOutMinimum) {
    return { checked: true, ok: false, kind: "short-delivery", received };
  }

  if (sellAmount == null) return { checked: true, ok: true, received, soldBack: null, sellAmount: null };

  if (results[at.sellApprove].status !== "0x1") {
    return { checked: true, ok: false, kind: "cannot-sell", received, detail: revertDetail(results[at.sellApprove]) };
  }
  if (results[at.sell].status !== "0x1") {
    return { checked: true, ok: false, kind: "cannot-sell", received, detail: revertDetail(results[at.sell]) };
  }
  const inBefore = balanceIn(results[at.inBefore]);
  const inAfter = balanceIn(results[at.inAfter]);
  if (inBefore == null || inAfter == null) {
    return { checked: false, reason: `${tokenIn.symbol}'s balance could not be read in the simulation` };
  }
  const soldBack = inAfter - inBefore;
  if (soldBack <= 0n) {
    return { checked: true, ok: false, kind: "cannot-sell", received, detail: "it returned nothing" };
  }
  return { checked: true, ok: true, received, soldBack, sellAmount };
}

function units(amount, token) {
  return `${Number(ethers.formatUnits(amount, token.decimals)).toFixed(6)} ${token.symbol}`;
}

export function describeTradeSafety({
  safety,
  side,
  chain,
  tokenIn,
  tokenOut,
  amountOutMinimum,
  needsApproval,
  allowance = 0n,
}) {
  const out = { blocks: [], warnings: [], needsAck: false };
  if (!safety) return out;
  const plainCheck = needsApproval
    ? "the swap itself is checked once the approval has confirmed"
    : "only a check that the swap itself does not fail was made";

  if (safety.checked) {
    if (safety.ok) return out;
    if (safety.kind === "approval-fails") {
      out.blocks.push(
        `The approval this trade needs would fail: ${safety.detail}.` +
          (allowance > 0n
            ? ` The exchange is already allowed to move ${units(allowance, tokenIn)}, and some tokens, ` +
              `USDT among them, refuse to change an allowance that is not zero. It has to be set to zero ` +
              `first in a transaction of its own: reset it below, then approve again.`
            : "")
      );
    } else if (safety.kind === "swap-fails") {
      out.blocks.push(`The swap would fail: ${safety.detail}`);
    } else if (safety.kind === "short-delivery") {
      out.blocks.push(
        `${tokenOut.symbol} takes a cut when it is transferred: in a simulation this trade delivered ` +
          `${units(safety.received, tokenOut)}, below the ${units(amountOutMinimum, tokenOut)} minimum, and the ` +
          `exchange cannot hold a token like this to that minimum. It was not offered.`
      );
    } else if (safety.kind === "cannot-sell") {
      out.blocks.push(
        `In a simulation, ${tokenOut.symbol} could be bought but selling it straight back to ` +
          `${tokenIn.symbol} failed (${safety.detail}). A token that cannot be sold traps the money spent on ` +
          `it, so this buy was not offered.`
      );
    }
    return out;
  }

  if (side === "buy" && !isVerifiedToken(chain, tokenOut)) {
    out.needsAck = true;
    out.warnings.push(
      `Whether ${tokenOut.symbol} can be sold again could not be checked on ${chain.name} ` +
        `(${safety.reason}). Some tokens can be bought and never sold, and ${plainCheck}.`
    );
  } else {
    out.warnings.push(
      `The pre-trade simulation could not run on ${chain.name} (${safety.reason}), so ${plainCheck}.`
    );
  }
  return out;
}
