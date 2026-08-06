import { useState } from "react";
import { Link } from "react-router-dom";
import { FlaskConical, Lock, TriangleAlert, Wallet } from "lucide-react";
import { Button, useToast } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { hasWallet } from "../wallet/keystore";
import { useChain } from "../../context/ChainContext";
import { setTradingMode } from "../wallet/walletApi";

/**
 * Paper vs live trading.
 *
 * PAPER IS THE DEFAULT FOR EVERYONE, including accounts that could trade live.
 * It is how somebody tries the agent before risking anything, so it is never
 * gated, never degraded, and needs no wallet.
 *
 * Live mode is opted into deliberately. The demo account is refused by the
 * SERVER — this component hides the control as a courtesy, but the rejection
 * that matters happens in the API, because the demo credentials are published.
 */
export default function TradingModeToggle({ mode, onChange }) {
  const { user, applyUser } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const walletReady = hasWallet();
  const { chain } = useChain();
  /**
   * The SERVER decides who may trade live; this only mirrors it. It used to
   * compare against a hardcoded "demo@ledgerwatch.app" here, which duplicated a
   * policy the API owns and would have silently disagreed with it the moment
   * that policy changed. Defaults to allowed so a stale user object cannot lock
   * someone out of their own wallet — the API refuses regardless.
   */
  const canTradeLive = user?.canTradeLive !== false;

  async function choose(next) {
    if (next === mode || busy) return;

    if (next === "live" && !walletReady) {
      toast("Live trading needs a wallet on this device. Create or import one first.", {
        type: "info",
      });
      return;
    }

    setBusy(true);
    try {
      const updated = await setTradingMode(next);
      if (applyUser) applyUser(updated);
      onChange(next);
      toast(
        next === "live"
          ? "Live trading on. Trades now spend real funds from your wallet."
          : "Paper trading on. Nothing here spends real funds.",
        { type: next === "live" ? "info" : "success" }
      );
    } catch (err) {
      toast(err?.response?.data?.error || "Could not change trading mode.", { type: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mode-toggle-wrap">
      <div className="mode-toggle" role="group" aria-label="Trading mode">
        <button
          type="button"
          className={mode === "paper" ? "mode-btn active" : "mode-btn"}
          onClick={() => choose("paper")}
          disabled={busy}
        >
          <FlaskConical size={14} /> Paper trading
        </button>
        <button
          type="button"
          className={mode === "live" ? "mode-btn active live" : "mode-btn"}
          onClick={() => choose("live")}
          disabled={busy || !canTradeLive}
          title={!canTradeLive ? "The shared demo account is limited to paper trading" : undefined}
        >
          {!canTradeLive ? <Lock size={14} /> : <Wallet size={14} />} Live wallet
        </button>
      </div>

      {!canTradeLive && (
        <p className="mode-note">
          <Lock size={13} />
          The shared demo account is permanently limited to paper trading, so anyone can explore it
          safely. Create your own account to trade live.
        </p>
      )}

      {canTradeLive && !walletReady && (
        <p className="mode-note">
          <Wallet size={13} />
          Live trading needs a wallet that can sign. <Link to="/app/wallet">Create or import one</Link>{" "}
          and it becomes available here.
        </p>
      )}

      {/* CHAIN-AWARE, deliberately. This said "Live mode spends real funds"
          regardless of network — false on a testnet, where the funds are
          worthless, and dangerously mild if a mainnet were ever selected. What
          "live" actually means is REAL SIGNING rather than a simulation; whether
          real money is involved is a separate question, answered by the chain. */}
      {mode === "live" && chain && !chain.testnet && (
        <p className="mode-note danger">
          <TriangleAlert size={13} />
          <span>
            <strong>{chain.name} is a real-money network.</strong> Trades spend real funds from
            your wallet and cannot be reversed. Every one is quoted, checked and signed by you
            individually.
          </span>
        </p>
      )}
      {mode === "live" && chain && chain.testnet && (
        <p className="mode-note">
          <TriangleAlert size={13} />
          <span>
            Live mode signs <strong>real transactions</strong> on <strong>{chain.name}</strong> with
            your own wallet — nothing here is simulated. {chain.name} is a test network, so the
            funds have <strong>no monetary value</strong>. Real-money networks are a separately
            gated step and are not enabled in this build.
          </span>
        </p>
      )}
    </div>
  );
}
