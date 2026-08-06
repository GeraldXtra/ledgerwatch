import { ArrowDownLeft, ArrowUpRight, ExternalLink } from "lucide-react";
import { Button, EmptyState } from "../../components/ui";

function shorten(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function when(value) {
  const d = new Date(value);
  return isNaN(d.getTime()) ? "" : d.toLocaleString();
}

/**
 * Locally-recorded transaction history.
 *
 * EVERY ROW NAMES ITS OWN CHAIN, and its explorer link is resolved from that
 * row's `chainId` rather than from whichever network happens to be selected.
 * The link previously came from the selected chain, which matched only because
 * the list is filtered per chain today — the first view showing more than one
 * network would have sent every link to the wrong explorer.
 *
 * Naming the chain is also the point: a row reading "−80 USDC · confirmed" with
 * no network is exactly what let a same-chain self-transfer look like a
 * completed cross-chain move.
 */
export default function TxHistory({ txs, chain, chains, onReceive }) {
  // Registry lookup, so no explorer URL is hardcoded here. Falls back to the
  // active chain for rows written before chainId was recorded.
  const chainFor = (tx) =>
    (chains || []).find((c) => c.chainId === tx.chainId) ||
    (chain && chain.chainId === tx.chainId ? chain : null);
  if (!txs || txs.length === 0) {
    return (
      <EmptyState
        icon={<ArrowUpRight size={20} />}
        title="No transactions yet"
        hint="Sends you make from this wallet appear here. Fund the wallet from a testnet faucet to get started."
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
        // A transfer to yourself on one network. Called out because it looks
        // like a successful move and is in fact a round trip that only cost a
        // fee — the single most confusing row this history can contain.
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
