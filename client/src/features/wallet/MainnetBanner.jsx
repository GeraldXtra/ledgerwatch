import { TriangleAlert } from "lucide-react";

/**
 * Shown on every wallet and trading screen whenever the selected chain is a
 * mainnet. Persistent by design: the testnet and mainnet versions of these
 * screens are otherwise identical, and the only thing distinguishing "practice"
 * from "irreversible" would be a chain name in a dropdown.
 *
 * Renders nothing on a testnet, so callers can drop it in unconditionally.
 */
export default function MainnetBanner({ chain }) {
  if (!chain || chain.testnet) return null;
  return (
    <div className="mainnet-banner">
      <TriangleAlert size={16} />
      <span>
        <strong>MAINNET — REAL FUNDS.</strong> You are on {chain.name}. Transactions here move real
        money, confirm in seconds and cannot be reversed by us or by anyone else.
      </span>
    </div>
  );
}
