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
