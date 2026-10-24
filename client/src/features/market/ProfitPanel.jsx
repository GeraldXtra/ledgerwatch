import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ExternalLink, PiggyBank } from "lucide-react";
import { Button, Card, SkeletonLines, StatusPill, useToast } from "../../components/ui";
import { fetchProfits, keepProfitInTradingWallet } from "./profitWallet";
import ProfitMoveModal from "./ProfitMoveModal";
import ProfitWithdrawModal from "./ProfitWithdrawModal";

const STATUS = {
  moved: { tone: "paid", label: "Moved" },
  pending: { tone: "pending", label: "Waiting for you" },
  moving: { tone: "partial", label: "Moving" },
  dismissed: { tone: "dismissed", label: "Kept in trading wallet" },
  loss: { tone: "neg", label: "Loss" },
  "no-basis": { tone: "cancelled", label: "Not measured" },
};

function money(n) {
  const v = Number(n || 0);
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `-$${s}` : `$${s}`;
}

function when(d) {
  return new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function reason(err) {
  return err?.response?.data?.error || err?.message || "the server did not answer";
}

export default function ProfitPanel({ mode, chains = [], mainAddress, paperProfitBalance = 0, reloadKey }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [moving, setMoving] = useState(null);
  const [withdrawing, setWithdrawing] = useState(null);

  const load = useCallback(() => {
    fetchProfits(mode)
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((err) => setError(`Your profit record could not be loaded: ${reason(err)}.`));
  }, [mode]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  useEffect(() => {
    const onPush = (e) => {
      const type = e.detail && e.detail.type;
      if (type === "profit" || type === "trades") load();
    };
    window.addEventListener("ledgerwatch:push", onPush);
    return () => window.removeEventListener("ledgerwatch:push", onPush);
  }, [load]);

  const chainOf = (id) => chains.find((c) => c.chainId === id) || null;

  const holdings = useMemo(() => {
    if (!data || !data.profitAddress) return [];
    const seen = new Map();
    for (const p of data.profits) {
      if (p.mode !== "live" || p.status !== "moved" || !p.cashAddress) continue;
      if (!chains.some((c) => c.chainId === p.chainId)) continue;
      const key = `${p.chainId}:${p.cashAddress}`;
      if (!seen.has(key)) {
        seen.set(key, { chainId: p.chainId, token: { address: p.cashAddress, symbol: p.cashSymbol, decimals: p.cashDecimals } });
      }
    }
    return [...seen.values()];
  }, [data, chains]);

  async function keep(p) {
    try {
      await keepProfitInTradingWallet(p._id);
      toast(`The ${money(p.profitUsd)} profit on ${p.symbol} stays in your trading wallet.`, { type: "success" });
      load();
    } catch (err) {
      toast(`That was not saved: ${reason(err)}. Nothing changed.`, { type: "error" });
    }
  }

  const isLive = mode === "live";
  const totals = (data && data.totals) || {};

  return (
    <Card
      eyebrow="Profit agent"
      title={isLive ? "Profit from live trades" : "Paper profit"}
      icon={<PiggyBank size={16} />}
      subtitle={
        isLive
          ? "Every sale is checked against what you paid. When there is a profit you are told, and you decide whether to move it to your profit wallet."
          : "Every sale is checked against what you paid. Profit is moved out of your trading cash into your profit balance straight away."
      }
    >
      <div className="kpi-row">
        {isLive ? (
          <>
            <div className="hero-figure">
              <span className="overline">Waiting to move</span>
              <span className="num mono-strong">{money(totals.pendingLive)}</span>
            </div>
            <div className="hero-figure">
              <span className="overline">Moved to profit wallet</span>
              <span className="num mono-strong">{money(totals.movedLive)}</span>
            </div>
          </>
        ) : (
          <>
            <div className="hero-figure">
              <span className="overline">Profit balance</span>
              <span className="num mono-strong">{money(paperProfitBalance)}</span>
            </div>
            <div className="hero-figure">
              <span className="overline">Profit recorded</span>
              <span className="num mono-strong">{money(totals.paper)}</span>
            </div>
          </>
        )}
      </div>

      {isLive && data && data.profitAddress && (
        <div className="stack-sm" style={{ marginTop: 12 }}>
          <span className="overline">Your profit wallet</span>
          <code className="sweep-dest">{data.profitAddress}</code>
          <span className="muted small">Account 2 of your recovery phrase.</span>
          {holdings.length > 0 && mainAddress && (
            <div className="row wrap">
              {holdings.map((h) => (
                <Button key={`${h.chainId}:${h.token.address}`} size="sm" onClick={() => setWithdrawing(h)}>
                  <ArrowDownToLine size={14} /> Move {h.token.symbol} on {chainOf(h.chainId).name} back
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {error ? (
        <div className="stack-sm" style={{ marginTop: 12 }}>
          <p className="error-text" style={{ margin: 0 }}>{error}</p>
          <div>
            <Button size="sm" onClick={load}>
              Try again
            </Button>
          </div>
        </div>
      ) : !data ? (
        <SkeletonLines count={3} />
      ) : data.profits.length === 0 ? (
        <p className="muted small" style={{ marginTop: 12 }}>
          Nothing sold yet. The profit agent records every sale here, profit or loss.
        </p>
      ) : (
        <ul className="tx-list" style={{ marginTop: 12 }}>
          {data.profits.map((p) => {
            const s = STATUS[p.status] || { tone: "pending", label: p.status };
            const chain = chainOf(p.chainId);
            const moveLink = p.moveTxHash && chain && chain.explorer ? `${chain.explorer}/tx/${p.moveTxHash}` : null;
            return (
              <li key={p._id} className="stack-sm crypto-tx-row">
                <div className="row space-between">
                  <div>
                    <div className="num mono-strong">
                      {p.status === "no-basis" ? `${p.symbol} sale` : `${money(p.profitUsd)} on ${p.symbol}`}
                      {p.profitPct != null && p.status !== "no-basis" && (
                        <span className="muted caption"> {p.profitPct.toFixed(2)}%</span>
                      )}
                    </div>
                    <div className="muted caption">
                      {when(p.createdAt)}
                      {chain ? ` · ${chain.name}` : ""}
                    </div>
                  </div>
                  <StatusPill status={s.tone}>{s.label}</StatusPill>
                </div>
                {(p.message || p.note) && (
                  <p className="muted small" style={{ margin: 0 }}>{p.message || p.note}</p>
                )}
                {p.message && p.note && <p className="muted caption" style={{ margin: 0 }}>{p.note}</p>}
                {moveLink && (
                  <a className="tx-hash-link" href={moveLink} target="_blank" rel="noopener noreferrer">
                    {p.moveTxHash.slice(0, 10)}…{p.moveTxHash.slice(-6)} <ExternalLink size={12} />
                  </a>
                )}
                {isLive && p.status === "pending" && (
                  <div className="row wrap">
                    <Button size="sm" variant="primary" disabled={!mainAddress || !chain} onClick={() => setMoving(p)}>
                      <PiggyBank size={14} /> Move to profit wallet
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => keep(p)}>
                      Keep in trading wallet
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {moving && (
        <ProfitMoveModal
          profit={moving}
          chain={chainOf(moving.chainId)}
          mainAddress={mainAddress}
          onClose={() => setMoving(null)}
          onDone={() => load()}
        />
      )}
      {withdrawing && (
        <ProfitWithdrawModal
          chain={chainOf(withdrawing.chainId)}
          token={withdrawing.token}
          profitAddress={data.profitAddress}
          mainAddress={mainAddress}
          onClose={() => setWithdrawing(null)}
          onDone={() => load()}
        />
      )}
    </Card>
  );
}
