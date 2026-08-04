import { ethers } from "ethers";

/**
 * GAS PREFLIGHT — one implementation, used by every path that can start a
 * transaction: send, sweep, approve and swap.
 *
 * The point is to answer "can this actually be paid for?" BEFORE the confirm
 * step, rather than letting the user type their password and then meet
 * "insufficient funds for amount + gas" from deep inside ethers. A wallet that
 * knows the answer up front can say exactly how much is missing and, on a
 * testnet, link straight to the faucet that fixes it.
 */

// An ERC-20 transfer costs ~45k gas to an address that already holds a balance,
// ~65k to a fresh one. Used only when the node refuses to estimate at all, and
// always reported as a fallback rather than presented as a real estimate.
export const ERC20_TRANSFER_GAS_FALLBACK = 100000n;

// A plain native transfer is exactly this, always.
export const NATIVE_TRANSFER_GAS = 21000n;

/**
 * Estimate gas for a transaction, degrading honestly when a node will not.
 *
 * Some nodes refuse to estimate FROM an address holding no native token, which
 * is precisely the case that matters most here. So the estimate is retried from
 * a funded address — the call shape is identical, so the number transfers — and
 * only then falls back to a constant.
 *
 * @returns {{gasLimit: bigint, source: string}} `source` is shown in the UI
 *   whenever it is not a true estimate.
 */
export async function estimateGasWithFallback({ provider, tx, from, fallbackFrom, fallback }) {
  try {
    const limit = await provider.estimateGas({ ...tx, from });
    return { gasLimit: limit, source: "estimated" };
  } catch {
    if (fallbackFrom && fallbackFrom !== from) {
      try {
        const limit = await provider.estimateGas({ ...tx, from: fallbackFrom });
        return { gasLimit: limit, source: "estimated from your main wallet" };
      } catch {
        /* fall through */
      }
    }
    return {
      gasLimit: fallback || ERC20_TRANSFER_GAS_FALLBACK,
      source: "a typical transaction cost, because this network would not estimate",
    };
  }
}

/** The fee-per-gas this chain is currently charging. */
export async function currentGasPrice(provider) {
  const fee = await provider.getFeeData();
  return fee.maxFeePerGas || fee.gasPrice || 0n;
}

/**
 * Can `from` afford this transaction?
 *
 * @param {bigint} [valueWei] native token being SENT (not gas). For a native
 *   transfer this must be included, or the check passes and the send still
 *   fails: the balance has to cover the amount AND the fee together.
 * @returns {Promise<{ok:boolean, gasLimit:bigint, gasPrice:bigint, feeWei:bigint,
 *   balanceWei:bigint, neededWei:bigint, shortfallWei:bigint, gasSource:string}>}
 */
export async function preflightGas({
  provider,
  from,
  tx,
  valueWei = 0n,
  fallbackFrom,
  fallbackGas,
}) {
  const [{ gasLimit, source }, gasPrice, balanceWei] = await Promise.all([
    estimateGasWithFallback({ provider, tx, from, fallbackFrom, fallback: fallbackGas }),
    currentGasPrice(provider),
    provider.getBalance(from),
  ]);

  const feeWei = gasLimit * gasPrice;
  const neededWei = feeWei + valueWei;
  const shortfallWei = neededWei > balanceWei ? neededWei - balanceWei : 0n;

  return {
    ok: shortfallWei === 0n,
    gasLimit,
    gasPrice,
    feeWei,
    balanceWei,
    neededWei,
    shortfallWei,
    gasSource: source,
  };
}

/** Trim a wei amount to a readable number of decimals without losing meaning. */
export function formatNative(wei, decimals = 6) {
  const s = ethers.formatEther(wei ?? 0n);
  const n = Number(s);
  if (n === 0) return "0";
  // Never round a tiny shortfall down to "0.000000" — that reads as "nothing
  // needed" when something IS needed.
  if (n < 10 ** -decimals) return `<${(10 ** -decimals).toFixed(decimals)}`;
  return n.toFixed(decimals).replace(/\.?0+$/, "");
}

/**
 * The sentence shown when a transaction cannot be paid for. States the exact
 * shortfall, because "insufficient funds" without a number leaves the user
 * guessing how much to get.
 */
export function shortfallMessage(plan, chain) {
  const symbol = (chain && chain.nativeSymbol) || "ETH";
  return (
    `Not enough ${symbol} to pay the network fee. ` +
    `You need about ${formatNative(plan.neededWei)} ${symbol} and hold ` +
    `${formatNative(plan.balanceWei)} ${symbol}, so you are short ` +
    `${formatNative(plan.shortfallWei)} ${symbol}.`
  );
}
