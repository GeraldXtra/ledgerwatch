import { ExternalLink, Network } from "lucide-react";

/**
 * "Assets live on ONE network."
 *
 * This exists because of a real incident, not a hypothetical. A user tried to
 * move 80 USDC from Ethereum Sepolia to Base Sepolia by sending it to their own
 * address. On-chain it was a plain ERC-20 transfer to themselves on Ethereum
 * Sepolia: it succeeded, history said so, and nothing moved. Both balances read
 * exactly as before, which looked like a bug and was in fact the truth.
 *
 * The reasoning behind that attempt is completely sound given what the app used
 * to say. The network switcher told them "one address, every network" — true —
 * and never said the other half: that balances are per-chain and a transfer
 * stays on the network it was made on. Given only the first half, sending to
 * your own address and choosing the network is the obvious inference.
 *
 * So this states both halves together, everywhere the mistake can be made.
 *
 * @param {object} chain    active chain, from the registry
 * @param {string} tone     "inline" (default) | "warning" for the blocked-send case
 */
export default function NetworkScopeNotice({ chain, tone = "inline" }) {
  if (!chain) return null;

  return (
    <div className={`net-scope-notice ${tone}`}>
      <Network size={15} className="net-scope-icon" />
      <div>
        <p className="net-scope-lead">
          Everything here happens on <strong>{chain.name}</strong>, and only there.
        </p>
        <p className="net-scope-body">
          Your address is the same on every network, but <strong>balances are not</strong> — each
          chain holds its own. Assets sent on {chain.name} exist only on {chain.name}. Sending to
          your own address does not move anything between networks; it just returns the funds to
          you on this one and costs a fee.
        </p>
        <p className="net-scope-body">
          LedgerWatch does not move assets between networks. That needs a bridge
          {chain.bridge ? (
            <>
              {" "}
              — for {chain.name}, use{" "}
              <a
                className="net-scope-link"
                href={chain.bridge.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {chain.bridge.name} <ExternalLink size={11} />
              </a>
              .
            </>
          ) : (
            // No verified route for this chain. Saying "use a bridge" without
            // naming one beats sending someone to a URL that may not exist.
            <> — you will need the official bridge for the route you want.</>
          )}
        </p>
      </div>
    </div>
  );
}
