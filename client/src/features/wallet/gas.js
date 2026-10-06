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
 * WOULD THIS TRANSACTION REVERT, AND WHY?
 *
 * A node refusing to estimate and a node saying "this call fails" are two
 * different answers that arrive through the same rejection, and treating them
 * alike is what let a doomed transfer reach the password box. Sending more of a
 * token than you hold, or one that is paused, or from an address the token has
 * blocked, all come back as an execution revert. A reverted transaction still
 * costs the full fee.
 *
 * ethers surfaces these as CALL_EXCEPTION, or with the node's own words in the
 * message. An INSUFFICIENT_FUNDS answer is NOT a revert: it is the node
 * declining to estimate for an address that cannot pay the gas, which is the
 * case the fallback below was written for and which `preflightGas` measures
 * properly a moment later.
 *
 * @returns {string|null} the reason to show, or null when this was not a revert
 */
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

  // The node's own reason first; it is the only text that names the actual
  // cause ("ERC20: transfer amount exceeds balance").
  return err.reason || message || "the network rejected it without saying why";
}

/**
 * Estimate gas for a transaction, degrading honestly when a node will not.
 *
 * Some nodes refuse to estimate FROM an address holding no native token, which
 * is precisely the case that matters most here. So the estimate is retried from
 * a funded address — the call shape is identical, so the number transfers — and
 * only then falls back to a constant.
 *
 * WHAT WAS WRONG WITH THAT ON ITS OWN. Both catches were bare, so a node
 * answering "this transfer would fail" was thrown away and replaced with a made
 * up 100,000 gas labelled "a typical transaction cost". The review screen then
 * showed an ordinary looking fee, offered the password box, and the user signed
 * a transaction the chain was certain to reject — paying the full mainnet fee
 * for nothing, with the only real explanation discarded two steps earlier. A
 * revert is now carried out of here as a fact, and the caller refuses.
 *
 * @returns {{gasLimit: bigint, source: string, reverted: boolean,
 *   revertReason: string|null}} `source` is shown in the UI whenever it is not
 *   a true estimate.
 */
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

/** One sentence for a revert, used wherever the source string is displayed. */
function revertSentence(reason) {
  return `the network says this transaction would fail (${reason})`;
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
 * `ok` is false for two different reasons and the caller must tell them apart:
 * `shortfallWei > 0` means the fee cannot be paid, `reverted` means the chain
 * has already said the transaction fails. Both block signing; only the first is
 * fixed by topping up gas.
 *
 * @returns {Promise<{ok:boolean, reverted:boolean, revertReason:string|null,
 *   gasLimit:bigint, gasPrice:bigint, feeWei:bigint, balanceWei:bigint,
 *   neededWei:bigint, shortfallWei:bigint, gasSource:string}>}
 */
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
    // A transaction the chain has already refused is never "ok", however much
    // gas is in the wallet: signing it burns the fee and changes nothing.
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
