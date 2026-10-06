import { Fuel, TriangleAlert } from "lucide-react";
import { formatNative, shortfallMessage } from "./gas";

/**
 * The one place a gas shortfall is explained, shared by send, sweep, approve and
 * swap so the wording never drifts between them.
 *
 * Renders nothing when the transaction is affordable, so callers can drop it in
 * unconditionally.
 */
export default function GasNotice({ plan, chain }) {
  if (!plan) return null;

  /**
   * THE CHAIN HAS ALREADY SAID NO.
   *
   * Checked before the shortfall, because these are different refusals and the
   * shortfall sentence would report "you are short 0" for this one. A revert was
   * previously invisible here: the estimate failed, a made up gas figure took
   * its place, and this rendered a calm "network fee is a typical transaction
   * cost" note over a transaction guaranteed to fail and to cost its full fee
   * anyway.
   */
  if (plan.reverted) {
    return (
      <div className="against-note">
        <TriangleAlert size={15} />
        <span>
          {(chain && chain.name) || "The network"} has already rejected this transaction, so
          signing it would cost the fee and change nothing. The reason it gave was:{" "}
          {plan.revertReason || "no reason"}. The usual causes are sending more of a token than
          you hold, or a token that will not let this address transfer.
        </span>
      </div>
    );
  }

  if (!plan.ok) {
    return (
      <div className="against-note">
        <TriangleAlert size={15} />
        <span>{shortfallMessage(plan, chain)}</span>
      </div>
    );
  }

  // Affordable, but the estimate was not a real one — say so rather than
  // presenting a guess with the same confidence as a measurement.
  if (plan.gasSource && plan.gasSource !== "estimated") {
    return (
      <p className="settings-note">
        <Fuel size={15} />
        Network fee is {plan.gasSource}, about {formatNative(plan.feeWei)}{" "}
        {(chain && chain.nativeSymbol) || "ETH"}.
      </p>
    );
  }

  return null;
}
