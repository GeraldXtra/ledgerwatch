import { ExternalLink, Network } from "lucide-react";

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
          Your address is the same on every network, but <strong>balances are not</strong>. Each
          chain holds its own. Assets sent on {chain.name} exist only on {chain.name}. Sending to
          your own address does not move anything between networks; it just returns the funds to
          you on this one and costs a fee.
        </p>
        <p className="net-scope-body">
          LedgerWatch does not move assets between networks. That needs a bridge
          {chain.bridge ? (
            <>
              . For {chain.name}, use{" "}
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
            <>. You will need the official bridge for the route you want.</>
          )}
        </p>
      </div>
    </div>
  );
}
