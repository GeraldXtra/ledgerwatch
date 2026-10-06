import { ethers } from "ethers";

export const ERC20_TRANSFER_GAS_FALLBACK = 100000n;

export const NATIVE_TRANSFER_GAS = 21000n;

export function revertReasonOf(err) {
  if (!err) return null;
  const code = err.code || err?.info?.error?.code;
  const message = String(err.shortMessage || err.reason || err.message || "");
  if (code === "INSUFFICIENT_FUNDS" || /insufficient funds/i.test(message)) return null;

  const reverted =
    code === "CALL_EXCEPTION" ||
    Boolean(err.reason) ||
    /execution reverted|revert|exceeds balance|transfer amount exceeds|paused|blacklist/i.test(
      message
    );
  if (!reverted) return null;

  return err.reason || message || "the network rejected it without saying why";
}

export async function estimateGasWithFallback({ provider, tx, from, fallbackFrom, fallback }) {
  try {
    const limit = await provider.estimateGas({ ...tx, from });
    return { gasLimit: limit, source: "estimated", reverted: false, revertReason: null };
  } catch (err) {
    const reason = revertReasonOf(err);
    if (reason) {
      return {
        gasLimit: fallback || ERC20_TRANSFER_GAS_FALLBACK,
        source: `not an estimate: ${revertSentence(reason)}`,
        reverted: true,
        revertReason: reason,
      };
    }
    if (fallbackFrom && fallbackFrom !== from) {
      try {
        const limit = await provider.estimateGas({ ...tx, from: fallbackFrom });
        return {
          gasLimit: limit,
          source: "estimated from your main wallet",
          reverted: false,
          revertReason: null,
        };
      } catch (secondErr) {
        const secondReason = revertReasonOf(secondErr);
        if (secondReason) {
          return {
            gasLimit: fallback || ERC20_TRANSFER_GAS_FALLBACK,
            source: `not an estimate: ${revertSentence(secondReason)}`,
            reverted: true,
            revertReason: secondReason,
          };
        }
      }
    }
    return {
      gasLimit: fallback || ERC20_TRANSFER_GAS_FALLBACK,
      source: "a typical transaction cost, because this network would not estimate",
      reverted: false,
      revertReason: null,
    };
  }
}

function revertSentence(reason) {
  return `the network says this transaction would fail (${reason})`;
}

export async function currentGasPrice(provider) {
  const fee = await provider.getFeeData();
  return fee.maxFeePerGas || fee.gasPrice || 0n;
}

export async function preflightGas({
  provider,
  from,
  tx,
  valueWei = 0n,
  fallbackFrom,
  fallbackGas,
}) {
  const [{ gasLimit, source, reverted, revertReason }, gasPrice, balanceWei] = await Promise.all([
    estimateGasWithFallback({ provider, tx, from, fallbackFrom, fallback: fallbackGas }),
    currentGasPrice(provider),
    provider.getBalance(from),
  ]);

  const feeWei = gasLimit * gasPrice;
  const neededWei = feeWei + valueWei;
  const shortfallWei = neededWei > balanceWei ? neededWei - balanceWei : 0n;

  return {
    ok: shortfallWei === 0n && !reverted,
    reverted: Boolean(reverted),
    revertReason: revertReason || null,
    gasLimit,
    gasPrice,
    feeWei,
    balanceWei,
    neededWei,
    shortfallWei,
    gasSource: source,
  };
}

export function formatNative(wei, decimals = 6) {
  const s = ethers.formatEther(wei ?? 0n);
  const n = Number(s);
  if (n === 0) return "0";
  if (n < 10 ** -decimals) return `<${(10 ** -decimals).toFixed(decimals)}`;
  return n.toFixed(decimals).replace(/\.?0+$/, "");
}

export function shortfallMessage(plan, chain) {
  const symbol = (chain && chain.nativeSymbol) || "ETH";
  return (
    `Not enough ${symbol} to pay the network fee. ` +
    `You need about ${formatNative(plan.neededWei)} ${symbol} and hold ` +
    `${formatNative(plan.balanceWei)} ${symbol}, so you are short ` +
    `${formatNative(plan.shortfallWei)} ${symbol}.`
  );
}
