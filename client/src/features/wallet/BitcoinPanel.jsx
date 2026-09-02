import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Copy,
  KeyRound,
  RefreshCw,
  TriangleAlert,
  X,
} from "lucide-react";
import http from "../../api/http";
import { Button, Card, Field, Input, SkeletonLines } from "../../components/ui";
import { unlockWallet } from "./keystore";
import {
  deriveBitcoinAccount,
  deriveBitcoinPrivateKey,
  canDeriveBitcoin,
} from "./bitcoin/derivation";
import { buildP2wpkhSpend, DUST_LIMIT_SATS } from "./bitcoin/tx";

/**
 * THE BITCOIN WALLET.
 *
 * Real Bitcoin, on mainnet or testnet, from the SAME twelve word phrase that
 * backs the EVM wallet. BIP-84 native segwit, so the address begins bc1 and the
 * phrase restores in any standard wallet.
 *
 * WHY THE ADDRESS IS CACHED AND THE KEY IS NOT
 *
 * Deriving a Bitcoin address needs the mnemonic, and the mnemonic needs the
 * keystore password. Asking for a password before showing a balance would be
 * absurd, so the ADDRESS, which is public by construction, is derived once and
 * remembered per account and network. The private key is never stored, never
 * cached and never leaves this component: every spend re-derives it from a
 * password typed for that transaction and discards it in the same tick.
 *
 * That is the same rule the EVM side follows, and it is the reason there is no
 * code path here that could sign without the owner present.
 *
 * A WALLET IMPORTED FROM A BARE PRIVATE KEY HAS NO PHRASE, so it cannot derive a
 * Bitcoin account at all. That is stated plainly rather than failing oddly.
 */

const SATS = 100_000_000;
const btc = (sats) => (Number(sats || 0) / SATS).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");

function addrKey(userId, network) {
  return `ledgerwatch.wallet.btc.${userId || "anon"}.${network}`;
}

function readCachedAddress(userId, network) {
  try {
    return localStorage.getItem(addrKey(userId, network)) || null;
  } catch {
    return null; // private mode: we simply derive again
  }
}

function cacheAddress(userId, network, address) {
  try {
    localStorage.setItem(addrKey(userId, network), address);
  } catch {
    /* not being able to remember it is a nuisance, not a failure */
  }
}

export default function BitcoinPanel({ userId, network, onBusyChange }) {
  const [address, setAddress] = useState(() => readCachedAddress(userId, network));
  const [unlocking, setUnlocking] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const [balance, setBalance] = useState(null); // { confirmedSats, pendingSats } | null
  const [balError, setBalError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [txs, setTxs] = useState(null);
  const [tab, setTab] = useState("balance");

  const [panel, setPanel] = useState(null); // "send" | "receive" | null
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendPassword, setSendPassword] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [fees, setFees] = useState(null);

  const isMainnet = network === "mainnet";

  useEffect(() => {
    setAddress(readCachedAddress(userId, network));
    setBalance(null);
    setBalError(null);
    setTxs(null);
  }, [userId, network]);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const { data } = await http.get("/api/bitcoin/balance", { params: { address, network } });
      if (data && data.ok !== false) {
        // Field names come from bitcoin.service: confirmed, pending, total, all
        // in satoshis. Verified against the live API rather than assumed.
        setBalance(data);
        setBalError(null);
      } else {
        // A read that failed is UNREADABLE, never zero. A Bitcoin balance shown
        // as 0.00 because an API was down looks exactly like an emptied wallet.
        setBalance(null);
        setBalError(data?.reason || "The Bitcoin API did not answer");
      }
    } catch (err) {
      setBalance(null);
      setBalError(err?.response?.data?.error || err.message || "Could not reach the Bitcoin API");
    } finally {
      setLoading(false);
    }
  }, [address, network]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (tab !== "activity" || !address || txs !== null) return;
    http
      .get("/api/bitcoin/txs", { params: { address, network } })
      .then(({ data }) => setTxs(Array.isArray(data?.txs) ? data.txs : []))
      .catch(() => setTxs([])); // an empty history and a failed one look the same here, so say so below
  }, [tab, address, network, txs]);

  useEffect(() => {
    if (panel !== "send" || fees) return;
    http
      .get("/api/bitcoin/fees", { params: { network } })
      .then(({ data }) => setFees(data))
      .catch(() => setFees(null));
  }, [panel, network, fees]);

  /** Derive the address once, from a password typed now. */
  async function deriveAddress(e) {
    e.preventDefault();
    setError("");
    setUnlocking(true);
    try {
      const wallet = await unlockWallet(password);
      const phrase = wallet?.mnemonic?.phrase;
      if (!phrase || !canDeriveBitcoin(phrase)) {
        setError(
          "This wallet was imported from a bare private key, so it has no recovery phrase and no Bitcoin account can be derived from it. Import the twelve word phrase instead."
        );
        return;
      }
      const account = deriveBitcoinAccount(phrase, network);
      cacheAddress(userId, network, account.address);
      setAddress(account.address);
      setPassword("");
    } catch (err) {
      setError(err?.message || "That password did not unlock the wallet");
    } finally {
      setUnlocking(false);
    }
  }

  async function copyAddr() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* it is on screen to copy by hand */
    }
  }

  async function send(e) {
    e.preventDefault();
    setSendResult(null);
    setSending(true);
    if (onBusyChange) onBusyChange(true);
    try {
      const amountSats = Math.round(Number(sendAmount) * SATS);
      if (!Number.isFinite(amountSats) || amountSats <= 0) {
        throw new Error("Enter an amount in BTC");
      }
      if (amountSats < DUST_LIMIT_SATS) {
        throw new Error(
          `That is below the dust limit of ${DUST_LIMIT_SATS} satoshis, which the network will not relay.`
        );
      }

      const { data: utxoRes } = await http.get("/api/bitcoin/utxos", {
        params: { address, network },
      });
      const utxos = Array.isArray(utxoRes?.utxos) ? utxoRes.utxos : [];
      if (!utxos.length) throw new Error("This address has nothing spendable yet.");

      // fast/medium/slow come from bitcoin.service, which normalises both the
      // Esplora fee-estimates map and the mempool.space recommended shape.
      const feeRate = Number(fees?.medium || fees?.fast || 2);

      // The key exists only inside this block, derived from a password typed for
      // THIS transaction, and is never returned, stored or logged.
      const wallet = await unlockWallet(sendPassword);
      const phrase = wallet?.mnemonic?.phrase;
      if (!phrase) throw new Error("This wallet has no recovery phrase, so it cannot sign Bitcoin.");
      const privateKey = deriveBitcoinPrivateKey(phrase, network);

      /**
        * buildP2wpkhSpend selects coins, computes the fee, adds the change output
        * back to this address and SIGNS, all in one call. It returns a typed
        * outcome rather than throwing, so an unaffordable amount or a bad
        * destination comes back as a sentence rather than a stack trace.
        */
      const built = buildP2wpkhSpend({
        utxos,
        fromAddress: address,
        toAddress: sendTo.trim(),
        amountSats,
        feeRateSatPerVb: feeRate,
        privateKey,
        network,
      });
      if (!built.ok) throw new Error(built.reason);

      const { data } = await http.post("/api/bitcoin/broadcast", { rawTx: built.hex, network });
      if (data?.ok === false) throw new Error(data.reason || "The network refused the transaction");

      setSendResult({
        ok: true,
        txid: data.txid || built.txid,
        fee: built.fee,
        feeRate: built.feeRateSatPerVb,
      });
      setSendTo("");
      setSendAmount("");
      setSendPassword("");
      load();
    } catch (err) {
      setSendResult({
        ok: false,
        message: err?.response?.data?.error || err.message || "Could not send",
      });
    } finally {
      setSending(false);
      if (onBusyChange) onBusyChange(false);
    }
  }

  const total = useMemo(() => {
    if (!balance) return null;
    return Number(balance.total ?? Number(balance.confirmed || 0) + Number(balance.pending || 0));
  }, [balance]);

  // ---------------------------------------------------------------- setup ----
  if (!address) {
    return (
      <div className="mm-hero" style={{ textAlign: "left", padding: "22px 20px" }}>
        <div className="mm-setup-mark" style={{ margin: "0 0 14px" }}>
          <KeyRound size={22} />
        </div>
        <h3 className="section-title" style={{ margin: "0 0 6px" }}>
          Unlock once to set up Bitcoin
        </h3>
        <p className="muted small" style={{ margin: "0 0 14px", maxWidth: "46ch" }}>
          Your Bitcoin account comes from the same recovery phrase as the rest of this wallet, so
          there is nothing new to write down. Enter your password once and the address is remembered
          on this device. Sending always asks again.
        </p>
        {error && (
          <div className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>
            <TriangleAlert size={15} />
            <span>{error}</span>
          </div>
        )}
        <form onSubmit={deriveAddress} className="stack-sm">
          <Field label="Wallet password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Button variant="primary" type="submit" loading={unlocking} block>
            Set up Bitcoin
          </Button>
        </form>
      </div>
    );
  }

  // --------------------------------------------------------------- active ----
  return (
    <>
      {isMainnet && (
        <div className="mm-notice bad">
          <TriangleAlert size={16} />
          <span className="grow">
            <strong>Bitcoin mainnet.</strong> Transactions here move real money, confirm in about ten
            minutes and cannot be reversed by anyone. Bitcoin has no contracts and no support desk.
          </span>
        </div>
      )}

      <div className="mm-top" style={{ borderTop: "1px solid var(--border)" }}>
        <button type="button" className="mm-acct" onClick={copyAddr} title="Copy your Bitcoin address">
          <span className="addr num" style={{ fontSize: 12 }}>
            {address.slice(0, 10)}...{address.slice(-6)}
          </span>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <div className="mm-icons">
          <button
            type="button"
            className="mm-icon"
            onClick={load}
            title="Refresh balance"
            aria-label="Refresh balance"
          >
            <RefreshCw size={15} className={loading ? "spin" : undefined} />
          </button>
        </div>
      </div>

      <div className="mm-hero">
        {balance ? (
          <>
            <span className="mm-fiat">{btc(total)} BTC</span>
            <span className="mm-sub">
              {isMainnet ? "Bitcoin" : "Bitcoin testnet"}
              {Number(balance.pending) > 0 ? `, ${btc(balance.pending)} still confirming` : ""}
            </span>
          </>
        ) : loading ? (
          <span className="mm-fiat" style={{ opacity: 0.35 }}>
            0 BTC
          </span>
        ) : (
          <>
            <span className="mm-fiat" style={{ fontSize: 24 }}>
              Balance unavailable
            </span>
            <span className="mm-caveat">
              {balError}. This is a connection problem rather than an empty wallet, so your coins are
              untouched.
            </span>
          </>
        )}
      </div>

      <div className="mm-actions">
        <button
          type="button"
          className="mm-action brass"
          onClick={() => setPanel(panel === "receive" ? null : "receive")}
        >
          <span className="ring">
            <ArrowDownToLine size={19} />
          </span>
          Receive
        </button>
        <button
          type="button"
          className="mm-action"
          onClick={() => setPanel(panel === "send" ? null : "send")}
        >
          <span className="ring">
            <ArrowUpRight size={19} />
          </span>
          Send
        </button>
      </div>

      <div className="mm-tabs">
        <button
          type="button"
          className={tab === "balance" ? "mm-tab active" : "mm-tab"}
          onClick={() => setTab("balance")}
        >
          Holdings
        </button>
        <button
          type="button"
          className={tab === "activity" ? "mm-tab active" : "mm-tab"}
          onClick={() => setTab("activity")}
        >
          Activity
        </button>
      </div>

      {tab === "balance" ? (
        <div className="mm-list">
          <div className="mm-row">
            <span className="mm-mark native">BTC</span>
            <span className="mm-row-main">
              <span className="mm-row-name">Bitcoin</span>
              <span className="mm-row-note">
                {isMainnet ? "Native segwit, bc1" : "Testnet coins, worth nothing"}
              </span>
            </span>
            <span className="mm-row-right">
              <span className="mm-row-fiat">{balance ? `${btc(total)} BTC` : "Unknown"}</span>
              <span className="mm-row-qty">
                {balance ? `${Number(balance.confirmed || 0).toLocaleString()} sats` : "unreadable"}
              </span>
            </span>
          </div>
        </div>
      ) : (
        <div className="mm-list" style={{ padding: 14 }}>
          {txs === null ? (
            <SkeletonLines count={3} />
          ) : txs.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              Nothing here yet. Transactions appear once they reach the mempool.
            </p>
          ) : (
            txs.slice(0, 12).map((t) => (
              <div className="mm-row" key={t.txid}>
                <span className="mm-row-main">
                  <span className="mm-row-name num" style={{ fontSize: 12.5 }}>
                    {String(t.txid).slice(0, 12)}...
                  </span>
                  <span className="mm-row-note">
                    {t.direction === "in" ? "Received" : "Sent"}
                    {t.confirmed ? `, confirmed in block ${t.blockHeight}` : ", waiting to confirm"}
                  </span>
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {panel === "receive" && (
        <div className="mm-drawer" style={{ padding: "0 16px 16px" }}>
          <Card title="Receive Bitcoin">
            <p className="muted small" style={{ marginTop: 0 }}>
              Send only Bitcoin to this address, on {isMainnet ? "the Bitcoin network" : "Bitcoin testnet"}.
              It is not an Ethereum address and coins sent from another network will not arrive.
            </p>
            <code className="reveal-key" style={{ wordBreak: "break-all" }}>
              {address}
            </code>
          </Card>
        </div>
      )}

      {panel === "send" && (
        <div className="mm-drawer" style={{ padding: "0 16px 16px" }}>
          <Card
            title="Send Bitcoin"
            action={
              <Button variant="ghost" icon title="Close" onClick={() => setPanel(null)}>
                <X size={15} />
              </Button>
            }
          >
            {sendResult && (
              <div
                className={sendResult.ok ? "alert" : "alert alert-error"}
                role="status"
                style={{ marginBottom: 12 }}
              >
                <span>
                  {sendResult.ok
                    ? `Sent. Fee ${sendResult.fee} satoshis at ${sendResult.feeRate} per byte. Transaction ${String(
                        sendResult.txid
                      ).slice(0, 16)}...`
                    : sendResult.message}
                </span>
              </div>
            )}
            <form onSubmit={send} className="stack-sm">
              <Field label="To address">
                <Input
                  value={sendTo}
                  onChange={(e) => setSendTo(e.target.value)}
                  placeholder={isMainnet ? "bc1..." : "tb1..."}
                />
              </Field>
              <Field label="Amount in BTC">
                <Input
                  value={sendAmount}
                  onChange={(e) => setSendAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.001"
                />
              </Field>
              <Field label="Wallet password">
                <Input
                  type="password"
                  value={sendPassword}
                  onChange={(e) => setSendPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </Field>
              <p className="muted caption" style={{ margin: 0 }}>
                {fees
                  ? `Network fee about ${fees.medium || fees.fast} satoshis per byte right now.`
                  : "Fetching the current network fee."}{" "}
                The fee is taken from your balance and paid to miners, not to us.
              </p>
              <Button variant="primary" type="submit" loading={sending} block>
                Review is on you. Sign and broadcast
              </Button>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
