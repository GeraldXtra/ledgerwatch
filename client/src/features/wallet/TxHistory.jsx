import { ArrowDownLeft, ArrowUpRight, ExternalLink } from "lucide-react";
import { EmptyState } from "../../components/ui";

function shorten(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function when(value) {
  const d = new Date(value);
  return isNaN(d.getTime()) ? "" : d.toLocaleString();
}

// Locally-recorded transaction history. Works with no Alchemy key; each row deep
// links to the correct block explorer for its chain.
export default function TxHistory({ txs, chain }) {
  if (!txs || txs.length === 0) {
    return (
      <EmptyState
        icon={<ArrowUpRight size={20} />}
        title="No transactions yet"
        hint="Sends you make from this wallet will appear here."
      />
    );
  }

  return (
    <ul className="tx-list">
      {txs.map((tx) => {
        const outgoing = tx.direction !== "in";
        return (
          <li key={tx._id || tx.hash} className="tx-row">
            <span className={`tx-icon ${outgoing ? "out" : "in"}`}>
              {outgoing ? <ArrowUpRight size={15} /> : <ArrowDownLeft size={15} />}
            </span>
            <div className="grow">
              <div className="tx-line">
                <span className="tx-amount num">
                  {outgoing ? "−" : "+"}
                  {tx.value} {tx.symbol}
                </span>
                <span className={`tx-status tx-${tx.status}`}>{tx.status}</span>
              </div>
              <div className="muted small num">
                {outgoing ? `To ${shorten(tx.to)}` : `From ${shorten(tx.from)}`} · {when(tx.createdAt)}
              </div>
            </div>
            {chain?.explorer && (
              <a
                className="tx-explorer"
                href={`${chain.explorer}/tx/${tx.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                title="View on explorer"
              >
                <ExternalLink size={14} />
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
