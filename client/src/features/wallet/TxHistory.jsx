import { ArrowDownLeft, ArrowUpRight, ExternalLink, RefreshCw } from "lucide-react";
import { Button, EmptyState } from "../../components/ui";

function shorten(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function when(value) {
  const d = new Date(value);
  return isNaN(d.getTime()) ? "" : d.toLocaleString();
}

export default function TxHistory({ txs, chain, chains, error, onRetry, onReceive }) {
  const chainFor = (tx) =>
    (chains || []).find((c) => c.chainId === tx.chainId) ||
    (chain && chain.chainId === tx.chainId ? chain : null);
  if (error && (!txs || txs.length === 0)) {
    return (
      <div className="stack-sm">
        <p className="error-text" style={{ margin: 0 }}>
          Your transaction history could not be loaded: {error}. This says nothing about your
          balance or about transfers you have made; only this list is missing.
        </p>
        {onRetry && (
          <div>
            <Button size="sm" onClick={onRetry}>
              <RefreshCw size={14} /> Try again
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (!txs || txs.length === 0) {
    return (
      <EmptyState
        icon={<ArrowUpRight size={20} />}
        title="No transactions yet"
        hint="Sends you make from this wallet appear here."
        action={
          onReceive && (
            <Button variant="primary" size="sm" onClick={onReceive}>
              <ArrowDownLeft size={14} /> Receive funds
            </Button>
          )
        }
      />
    );
  }

  return (
    <ul className="tx-list">
      {txs.map((tx) => {
        const outgoing = tx.direction !== "in";
        const txChain = chainFor(tx);
        const selfSend =
          tx.from && tx.to && tx.from.toLowerCase() === tx.to.toLowerCase();
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
              <div className="tx-chain-line">
                <span className="tx-chain">{txChain ? txChain.name : `chain ${tx.chainId}`}</span>
                {selfSend && (
                  <span className="tx-selfsend" title="Sent to your own address on this network">
                    to yourself · stayed on this network
                  </span>
                )}
              </div>
            </div>
            {txChain?.explorer && (
              <a
                className="tx-explorer"
                href={`${txChain.explorer}/tx/${tx.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                title={`View on ${txChain.name} explorer`}
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
