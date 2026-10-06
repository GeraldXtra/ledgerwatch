import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import {
  ArrowDownToLine,
  ExternalLink,
  Inbox,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Button, SkeletonLines } from "../../components/ui";
import { getProvider, ERC20_ABI, rpcErrorReason } from "./provider";
import { fetchPaymentAddresses } from "../receivables/cryptoApi";
import SweepModal from "../receivables/SweepModal";
import { ngn, shortHash, usdcAmount } from "../receivables/format";

export default function CollectedPanel({ chain, mainAddress, sweepDestination, onSwept }) {
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [sweeping, setSweeping] = useState(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!chain) return;
    setRefreshing(true);
    try {
      const data = await fetchPaymentAddresses();
      const mine = (data.addresses || []).filter((a) => a.chainId === chain.chainId);

      const provider = getProvider(chain.chainId);
      const withBalances = await Promise.all(
        mine.map(async (pa) => {
          try {
            const token = new ethers.Contract(pa.tokenContract, ERC20_ABI, provider);
            const stored = Number(pa.tokenDecimals);
            const decimals =
              Number.isInteger(stored) && stored >= 0 && stored <= 36
                ? stored
                : Number(await token.decimals());
            if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
              throw new Error("This token's contract did not report its decimals");
            }
            const raw = await token.balanceOf(pa.address);
            let nativeAmount = null;
            try {
              nativeAmount = Number(ethers.formatEther(await provider.getBalance(pa.address)));
            } catch {
              nativeAmount = null;
            }
            return {
              ...pa,
              live: Number(ethers.formatUnits(raw, decimals)),
              nativeAmount,
              failed: false,
            };
          } catch {
            return { ...pa, live: null, nativeAmount: null, failed: true };
          }
        })
      );

      setRows(
        withBalances.filter(
          (r) => r.failed || (r.live && r.live > 0) || (r.nativeAmount && r.nativeAmount > 0)
        )
      );
      setError("");
    } catch (err) {
      setRows([]);
      const reason = rpcErrorReason(err);
      setError(
        reason ? `Could not load collected balances: ${reason}` : "Could not load collected balances."
      );
    } finally {
      setRefreshing(false);
    }
  }, [chain]);

  useEffect(() => {
    setSelected(new Set());
    load();
  }, [load]);

  const sweepable = useMemo(() => (rows || []).filter((r) => !r.failed && r.live > 0), [rows]);

  const totals = useMemo(() => {
    const chosen = sweepable.filter((r) => selected.has(r._id));
    return {
      count: chosen.length,
      usdc: chosen.reduce((s, r) => s + r.live, 0),
      ngn: chosen.reduce((s, r) => s + r.live * (Number(r.ngnPerUsd) || 0), 0),
    };
  }, [sweepable, selected]);

  const allSelected = sweepable.length > 0 && selected.size === sweepable.length;

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(sweepable.map((r) => r._id)));
  }

  if (rows === null) return <SkeletonLines count={3} />;

  if (error) {
    return (
      <div className="stack-sm">
        <p className="error-text" style={{ margin: 0 }}>
          {error}
        </p>
        <div>
          <Button onClick={load}>
            <RefreshCw size={14} /> Try again
          </Button>
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="collected-empty">
        <span className="icon-tile neutral">
          <Inbox size={18} />
        </span>
        <div>
          <div className="card-title">Nothing collected on {chain ? chain.name : "this network"}</div>
          <p className="muted small" style={{ margin: "4px 0 0", maxWidth: "56ch" }}>
            When a client pays an invoice in {chain?.tokens?.[0]?.symbol || "USDC"}, the address
            issued for that invoice appears here so you can move the funds into this wallet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="stack-sm">
      <div className="row space-between wrap">
        <div>
          <h3 className="section-title" style={{ margin: 0 }}>
            Collected payments
          </h3>
          <p className="muted small" style={{ margin: "3px 0 0" }}>
            Balances read live from {chain.name}. Sweeping moves them into this wallet.
          </p>
        </div>
        <div className="row">
          <Button variant="ghost" icon title="Refresh balances" onClick={load} disabled={refreshing}>
            <RefreshCw size={15} />
          </Button>
          <Button
            variant="primary"
            disabled={totals.count === 0}
            onClick={() => setSweeping(sweepable.filter((r) => selected.has(r._id)))}
          >
            <ArrowDownToLine size={15} />
            {totals.count === 0
              ? "Select to sweep"
              : totals.count === 1
              ? "Sweep 1 address"
              : `Sweep ${totals.count} addresses`}
          </Button>
        </div>
      </div>

      {sweepable.length > 1 && (
        <label className="toggle-row collected-all">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          <span>
            <span className="toggle-title">Select all {sweepable.length}</span>
            {totals.count > 0 && (
              <span className="muted small">
                {usdcAmount(totals.usdc)} {sweepable[0].tokenSymbol} selected, about{" "}
                {ngn(totals.ngn)}
              </span>
            )}
          </span>
        </label>
      )}

      <ul className="tx-list collected-list">
        {rows.map((r) => {
          const explorer = chain?.explorer ? `${chain.explorer}/address/${r.address}` : null;
          return (
            <li key={r._id} className="row space-between crypto-tx-row">
              <label className="row collected-row-main">
                <input
                  type="checkbox"
                  checked={selected.has(r._id)}
                  disabled={r.failed || !(r.live > 0)}
                  onChange={() => toggle(r._id)}
                />
                <div>
                  <div className="num mono-strong">
                    {r.failed ? "Balance unavailable" : `${usdcAmount(r.live)} ${r.tokenSymbol}`}
                  </div>
                  <div className="muted caption">
                    {r.debtorName ? `${r.debtorName} · ` : ""}
                    <code>{shortHash(r.address)}</code>
                    {!r.failed && r.live > 0 && r.ngnPerUsd
                      ? ` · about ${ngn(r.live * r.ngnPerUsd)}`
                      : ""}
                  </div>
                  {r.nativeAmount > 0 && (
                    <div className="inline-warn">
                      This address also holds{" "}
                      {r.nativeAmount.toLocaleString(undefined, { maximumFractionDigits: 8 })}{" "}
                      {chain.nativeSymbol}, which a payer sent instead of {r.tokenSymbol}. It is
                      not part of the invoice and cannot be swept from here, but your recovery
                      phrase controls this address, so the funds are reachable.
                    </div>
                  )}
                </div>
              </label>
              <div className="row">
                <span className={`pill ${r.status === "active" ? "" : "warn"}`}>{r.status}</span>
                {explorer && (
                  <a
                    className="tx-hash-link"
                    href={explorer}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on the block explorer"
                  >
                    <ExternalLink size={13} />
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="settings-note">
        <ShieldCheck size={15} />
        Each address is controlled by this wallet's recovery phrase. Sweeping signs a transfer
        locally with your password, and nothing moves until you approve it.
      </p>

      {sweeping && (
        <SweepModal
          addresses={sweeping}
          chains={[chain]}
          mainAddress={mainAddress}
          destination={sweepDestination || mainAddress}
          onClose={() => setSweeping(null)}
          onDone={() => {
            setSelected(new Set());
            load();
            if (onSwept) onSwept();
          }}
        />
      )}
    </div>
  );
}
