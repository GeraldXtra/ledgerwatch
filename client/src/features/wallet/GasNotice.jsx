import { Fuel, TriangleAlert } from "lucide-react";
import { formatNative, shortfallMessage } from "./gas";

export default function GasNotice({ plan, chain }) {
  if (!plan) return null;

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
