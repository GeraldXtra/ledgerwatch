import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Ban,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  RefreshCw,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import http from "../../api/http";
import { Button, Card, Field, Input, SkeletonLines } from "../../components/ui";
import TokenLogo from "../../components/TokenLogo";
import { unlockWallet } from "./keystore";
import {
  deriveBitcoinAccount,
  deriveBitcoinPrivateKey,
  canDeriveBitcoin,
} from "./bitcoin/derivation";
import {
  buildP2wpkhSpend,
  planP2wpkhSpend,
  planCancel,
  validateDestination,
  DUST_LIMIT_SATS,
} from "./bitcoin/tx";
import {
  readCachedBitcoinAddress,
  cacheBitcoinAddress,
} from "./bitcoin/addressCache";

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
 * remembered per account, per keystore and per network (see addressCache.js for
 * why the keystore is part of that). The private key is never stored, never
 * cached and never leaves this component: every spend re-derives it from a
 * password typed for that transaction and discards it in the same tick.
 *
 * SENDING IS THREE STEPS, NOT ONE
 *
 *   1. The form: destination, amount, fee speed. Checked as typed.
 *   2. The review: the exact inputs, the exact fee, the exact change and the
 *      balance afterwards, computed with no key. Nothing has been signed.
 *   3. The password: the key exists for one call, signs the plan that was
 *      reviewed, and the result is broadcast.
 *
 * The plan's inputs are handed back to the builder, so what was reviewed is
 * what is signed, to the satoshi. There is no path from the form to the network
 * that skips the review.
 *
 * A BROADCAST THAT MAY OR MAY NOT HAVE LANDED IS NOT A FAILURE. The server
 * reports it as `kind: "ambiguous"` and this panel shows it as exactly that,
 * keeps the transaction id on screen, checks the address on request, and will
 * not let a second copy be signed until the person has confirmed the first is
 * not there. Reporting it as an error was how a payment got sent twice.
 *
 * EVERY SPEND IS REPLACEABLE. A transaction stuck at too low a fee can be sped
 * up, or cancelled back to this wallet, from the activity view.
 */

const SATS = 100_000_000;
const btc = (sats) => (Number(sats || 0) / SATS).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
const sats = (n) => Number(n || 0).toLocaleString();

/** Fee estimates older than this are refetched before they are used. */
const FEES_STALE_MS = 2 * 60 * 1000;

function explorerTx(network, txid) {
  return network === "mainnet"
    ? `https://mempool.space/tx/${txid}`
    : `https://mempool.space/testnet/tx/${txid}`;
}

export default function BitcoinPanel({ userId, network, evmAddress = null, onBusyChange }) {
  const [address, setAddress] = useState(() => readCachedBitcoinAddress(userId, network, evmAddress));
  const [unlocking, setUnlocking] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const [balance, setBalance] = useState(null); // { confirmed, pending, total } in sats | null
  const [balError, setBalError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [txs, setTxs] = useState(null); // null = not loaded, [] = loaded and empty
  const [txsError, setTxsError] = useState(null);
  const [tab, setTab] = useState("balance");

  const [panel, setPanel] = useState(null); // "send" | "receive" | null

  // ---- fees: fetched per network, with an age, and never assumed ----
  const [fees, setFees] = useState(null); // { network, fast, medium, slow, ... } | null
  const [feesAt, setFeesAt] = useState(0);
  const [feesError, setFeesError] = useState(null);
  const [feeChoice, setFeeChoice] = useState("medium"); // "fast" | "medium" | "slow"

  // ---- the send flow ----
  const [step, setStep] = useState("form"); // "form" | "review"
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendPassword, setSendPassword] = useState("");
  const [plan, setPlan] = useState(null); // planP2wpkhSpend result, no key involved
  const [planning, setPlanning] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");

  // The last transaction this panel broadcast, while it is still worth acting on.
  const [lastSend, setLastSend] = useState(null);
  // A broadcast whose outcome the network did not confirm. Blocks sending.
  const [ambiguous, setAmbiguous] = useState(null);
  const [checking, setChecking] = useState(false);

  // ---- replace by fee ----
  const [bump, setBump] = useState(null); // { mode: "speed"|"cancel", rate, password, busy, error }

  const isMainnet = network === "mainnet";

  /**
   * A network change resets EVERYTHING that belongs to the other network. The
   * fee rates most of all: a testnet estimate of 2 sat/vB applied to a mainnet
   * send broadcasts successfully at a rate nobody mines, and the coins sit
   * locked in the mempool for two weeks. `fees` used to survive this switch.
   */
  useEffect(() => {
    setAddress(readCachedBitcoinAddress(userId, network, evmAddress));
    setBalance(null);
    setBalError(null);
    setTxs(null);
    setTxsError(null);
    setFees(null);
    setFeesAt(0);
    setFeesError(null);
    setPanel(null);
    setStep("form");
    setPlan(null);
    setSendTo("");
    setSendAmount("");
    setSendPassword("");
    setSendError("");
    setLastSend(null);
    setAmbiguous(null);
    setBump(null);
  }, [userId, network, evmAddress]);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const { data } = await http.get("/api/bitcoin/balance", { params: { address, network } });
      if (data && data.ok !== false) {
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

  const loadTxs = useCallback(async () => {
    if (!address) return null;
    try {
      const { data } = await http.get("/api/bitcoin/txs", { params: { address, network } });
      const list = Array.isArray(data?.txs) ? data.txs : [];
      setTxs(list);
      setTxsError(null);
      return list;
    } catch (err) {
      // A failed history is NOT an empty one, and the activity view says which.
      setTxs([]);
      setTxsError(err?.response?.data?.error || err.message || "Could not load the history");
      return null;
    }
  }, [address, network]);

  useEffect(() => {
    if (tab !== "activity" || !address || txs !== null) return;
    loadTxs();
  }, [tab, address, txs, loadTxs]);

  /**
   * Fetch fee rates for THIS network, and refuse to keep stale ones. The
   * response carries `network`, which is checked on use as well as here, so a
   * rate from the other network can never be applied even by a race.
   */
  const refreshFees = useCallback(
    async (force = false) => {
      if (!force && fees && fees.network === network && Date.now() - feesAt < FEES_STALE_MS) {
        return fees;
      }
      try {
        const { data } = await http.get("/api/bitcoin/fees", { params: { network } });
        if (data && data.ok !== false && data.network === network) {
          setFees(data);
          setFeesAt(Date.now());
          setFeesError(null);
          return data;
        }
        setFees(null);
        setFeesError(data?.reason || "The fee estimate did not answer for this network");
        return null;
      } catch (err) {
        setFees(null);
        setFeesError(err?.response?.data?.error || err.message || "Could not fetch fee rates");
        return null;
      }
    },
    [fees, feesAt, network]
  );

  useEffect(() => {
    if (panel === "send") refreshFees();
  }, [panel, refreshFees]);

  /**
   * While the last send is unconfirmed, watch for it so the speed up and cancel
   * controls disappear on their own the moment it is mined.
   */
  useEffect(() => {
    if (!lastSend || lastSend.confirmed) return undefined;
    let alive = true;
    const tick = async () => {
      const list = await loadTxs();
      if (!alive || !list) return;
      const hit = list.find((t) => t.txid === lastSend.txid);
      if (hit && hit.confirmed) {
        setLastSend((s) => (s && s.txid === lastSend.txid ? { ...s, confirmed: true } : s));
        setBump(null);
        load();
      }
    };
    const timer = setInterval(tick, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [lastSend, loadTxs, load]);

  /** Derive the address once, from a password typed now. */
  async function deriveAddress(e) {
    e.preventDefault();
    setError("");
    setUnlocking(true);
    try {
      const wallet = await unlockWallet(password);
      const phrase = wallet?.mnemonic?.phrase;
      const can = canDeriveBitcoin(phrase);
      if (!phrase || !can.ok) {
        setError(
          can.reason ||
            "This wallet was imported from a bare private key, so it has no recovery phrase and no Bitcoin account can be derived from it. Import the twelve word phrase instead."
        );
        return;
      }
      const account = deriveBitcoinAccount(phrase, network);
      cacheBitcoinAddress(userId, network, account.address, evmAddress || wallet.address);
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

  // ---------------------------------------------------------------- send ----

  const feeRate = useMemo(() => {
    if (!fees || fees.network !== network) return null;
    const v = Number(fees[feeChoice]);
    return Number.isFinite(v) && v >= 1 ? v : null;
  }, [fees, feeChoice, network]);

  const destCheck = useMemo(
    () => (sendTo.trim() ? validateDestination(sendTo, network) : null),
    [sendTo, network]
  );

  function amountToSats(value) {
    const n = Number(String(value).trim());
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * SATS);
  }

  function openSend() {
    if (panel === "send") {
      setPanel(null);
      return;
    }
    setPanel("send");
    setStep("form");
    setPlan(null);
    setSendError("");
    refreshFees();
  }

  /** Step 1 to 2. Everything checked and summed. No key. */
  async function review(e) {
    e.preventDefault();
    setSendError("");
    if (ambiguous) {
      setSendError("A previous send has not been resolved. Check it below before sending again.");
      return;
    }

    const dest = validateDestination(sendTo, network);
    if (!dest.ok) {
      setSendError(dest.reason);
      return;
    }
    const amountSats = amountToSats(sendAmount);
    if (amountSats == null) {
      setSendError("Enter an amount in BTC.");
      return;
    }
    if (amountSats < DUST_LIMIT_SATS) {
      setSendError(
        `That is below the dust limit of ${DUST_LIMIT_SATS} satoshis, which the network will not relay.`
      );
      return;
    }

    // Fresh fees, always. A rate from two minutes ago on a busy day is a rate
    // the network has already moved past.
    const current = await refreshFees();
    const rate = current && current.network === network ? Number(current[feeChoice]) : null;
    if (!Number.isFinite(rate) || rate < 1) {
      setSendError(
        "The current network fee could not be fetched, so the send was not prepared. Nothing is guessed here: try again in a moment."
      );
      return;
    }

    setPlanning(true);
    try {
      const { data: utxoRes } = await http.get("/api/bitcoin/utxos", {
        params: { address, network },
      });
      const utxos = Array.isArray(utxoRes?.utxos) ? utxoRes.utxos : [];
      if (!utxos.length) {
        setSendError("This address has nothing spendable yet.");
        return;
      }
      const p = planP2wpkhSpend({
        utxos,
        fromAddress: address,
        toAddress: sendTo.trim(),
        amountSats,
        feeRateSatPerVb: rate,
        network,
      });
      if (!p.ok) {
        setSendError(p.reason);
        return;
      }
      setPlan(p);
      setSendPassword("");
      setStep("review");
    } catch (err) {
      setSendError(err?.response?.data?.error || err.message || "Could not prepare the send");
    } finally {
      setPlanning(false);
    }
  }

  /** Step 2 to 3. The reviewed plan is signed, exactly, and broadcast. */
  async function confirmSend(e) {
    e.preventDefault();
    if (!plan) return;
    setSendError("");
    setSending(true);
    if (onBusyChange) onBusyChange(true);

    // Hoisted so the catch can keep the txid of whatever was signed.
    let built = null;
    try {
      // The key exists only inside this block, derived from a password typed for
      // THIS transaction, and is never returned, stored or logged.
      const wallet = await unlockWallet(sendPassword);
      const phrase = wallet?.mnemonic?.phrase;
      if (!phrase) throw new Error("This wallet has no recovery phrase, so it cannot sign Bitcoin.");
      const privateKey = deriveBitcoinPrivateKey(phrase, network);

      built = buildP2wpkhSpend({
        utxos: plan.inputs,
        forceInputs: plan.inputs, // sign what was reviewed, not a fresh selection
        fromAddress: address,
        toAddress: plan.toAddress,
        amountSats: plan.amountSats,
        feeRateSatPerVb: plan.feeRateSatPerVb,
        privateKey,
        network,
        allowUnconfirmed: true, // the plan already applied the confirmation rule
      });
      if (!built.ok) throw new Error(built.reason);

      const { data } = await http.post("/api/bitcoin/broadcast", { rawTx: built.hex, network });
      if (data?.ok === false) throw new Error(data.reason || "The network refused the transaction");

      setLastSend({
        txid: data.txid || built.txid,
        to: plan.toAddress,
        amountSats: plan.amountSats,
        fee: built.fee,
        feeRateSatPerVb: built.feeRateSatPerVb,
        vsize: built.vsize,
        inputs: built.inputs,
        network,
        at: Date.now(),
        confirmed: false,
      });
      setSendTo("");
      setSendAmount("");
      setSendPassword("");
      setPlan(null);
      setStep("form");
      setTab("activity");
      setTxs(null);
      load();
    } catch (err) {
      const data = err?.response?.data;
      /**
       * THE ONE OUTCOME THAT MUST NOT LOOK LIKE A FAILURE.
       *
       * The server could not tell whether the network accepted the broadcast.
       * The transaction may be live. Showing that as an error, with the form
       * still filled in, is how a second copy from different coins gets signed
       * and the payee is paid twice. So it becomes its own state that blocks
       * sending, keeps the transaction id, and offers to check.
       */
      if (data && (data.kind === "ambiguous" || data.resendUnsafe)) {
        setAmbiguous({
          txid: built?.txid || null,
          to: plan.toAddress,
          amountSats: plan.amountSats,
          fee: built?.fee || plan.fee,
          feeRateSatPerVb: built?.feeRateSatPerVb || plan.feeRateSatPerVb,
          vsize: built?.vsize || plan.vsize,
          inputs: built?.inputs || plan.inputs,
          message: data.error,
        });
        setSendPassword("");
        setStep("form");
        setPlan(null);
        return;
      }
      setSendError(data?.error || err.message || "Could not send");
      setSendPassword("");
    } finally {
      setSending(false);
      if (onBusyChange) onBusyChange(false);
    }
  }

  /**
   * Look for the ambiguous transaction at the address. Found means it was sent
   * after all and becomes the last send. Not found means the person may send
   * again, but only after they have seen that answer.
   */
  async function checkAmbiguous() {
    if (!ambiguous) return;
    setChecking(true);
    try {
      const list = await loadTxs();
      await load();
      if (list && ambiguous.txid && list.some((t) => t.txid === ambiguous.txid)) {
        const hit = list.find((t) => t.txid === ambiguous.txid);
        setLastSend({
          txid: ambiguous.txid,
          to: ambiguous.to,
          amountSats: ambiguous.amountSats,
          fee: ambiguous.fee,
          feeRateSatPerVb: ambiguous.feeRateSatPerVb,
          vsize: ambiguous.vsize,
          inputs: ambiguous.inputs,
          network,
          at: Date.now(),
          confirmed: Boolean(hit && hit.confirmed),
        });
        setAmbiguous(null);
        setSendTo("");
        setSendAmount("");
        setTab("activity");
      } else {
        setAmbiguous((a) => (a ? { ...a, checkedAt: Date.now(), found: false } : a));
      }
    } finally {
      setChecking(false);
    }
  }

  // ---------------------------------------------------------- replace ----

  function startBump(mode) {
    if (!lastSend || lastSend.confirmed) return;
    const fast = fees && fees.network === network ? Number(fees.fast) : null;
    // Suggest the faster of "what the network wants now" and "a third more than
    // before", and never less than the original plus one.
    const suggested = Math.max(
      Math.ceil(lastSend.feeRateSatPerVb * 1.3),
      Number.isFinite(fast) ? fast : 0,
      Math.floor(lastSend.feeRateSatPerVb) + 1
    );
    refreshFees();
    setBump({ mode, rate: String(suggested), password: "", busy: false, error: "" });
  }

  async function confirmBump(e) {
    e.preventDefault();
    if (!bump || !lastSend) return;
    const rate = Number(bump.rate);
    if (!Number.isFinite(rate) || rate < 1) {
      setBump((b) => ({ ...b, error: "Enter a fee rate of at least 1 satoshi per vbyte." }));
      return;
    }
    setBump((b) => ({ ...b, busy: true, error: "" }));
    if (onBusyChange) onBusyChange(true);
    try {
      const replacing = { fee: lastSend.fee, feeRateSatPerVb: lastSend.feeRateSatPerVb };
      let toAddress = lastSend.to;
      let amountSats = lastSend.amountSats;

      if (bump.mode === "cancel") {
        const c = planCancel({
          inputs: lastSend.inputs,
          fromAddress: address,
          feeRateSatPerVb: rate,
          network,
          replacing,
        });
        if (!c.ok) throw new Error(c.reason);
        toAddress = address;
        amountSats = c.amountSats;
      }

      const wallet = await unlockWallet(bump.password);
      const phrase = wallet?.mnemonic?.phrase;
      if (!phrase) throw new Error("This wallet has no recovery phrase, so it cannot sign Bitcoin.");
      const privateKey = deriveBitcoinPrivateKey(phrase, network);

      const built = buildP2wpkhSpend({
        utxos: lastSend.inputs,
        forceInputs: lastSend.inputs, // BIP 125: a replacement spends the same inputs
        fromAddress: address,
        toAddress,
        amountSats,
        feeRateSatPerVb: rate,
        privateKey,
        network,
        allowUnconfirmed: true,
        replacing,
        // Paying the whole balance back to yourself minus the fee is the point
        // of a cancellation, so the fee can legitimately dominate a small one.
        allowFeeAboveAmount: bump.mode === "cancel",
      });
      if (!built.ok) throw new Error(built.reason);

      const { data } = await http.post("/api/bitcoin/broadcast", { rawTx: built.hex, network });
      if (data?.ok === false) throw new Error(data.reason || "The network refused the replacement");

      setLastSend({
        txid: data.txid || built.txid,
        to: toAddress,
        amountSats,
        fee: built.fee,
        feeRateSatPerVb: built.feeRateSatPerVb,
        vsize: built.vsize,
        inputs: built.inputs,
        network,
        at: Date.now(),
        confirmed: false,
        replaced: lastSend.txid,
        cancelled: bump.mode === "cancel",
      });
      setBump(null);
      setTxs(null);
      load();
    } catch (err) {
      const data = err?.response?.data;
      if (data && (data.kind === "ambiguous" || data.resendUnsafe)) {
        // A replacement can be ambiguous too. Either the old or the new one
        // is live; the activity view will show which. Do not let it be
        // attempted again blind.
        setBump((b) => ({
          ...b,
          busy: false,
          error:
            "The network did not confirm whether it accepted the replacement. Refresh the activity list to see which version is live before trying again.",
        }));
        setTxs(null);
        return;
      }
      setBump((b) => ({ ...b, busy: false, error: data?.error || err.message || "Could not replace" }));
    } finally {
      if (onBusyChange) onBusyChange(false);
      setBump((b) => (b ? { ...b, busy: false, password: "" } : b));
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
          on this device for this wallet. Sending always asks again.
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
  const feeOptions = ["fast", "medium", "slow"];
  const feeLabel = { fast: "Fast", medium: "Normal", slow: "Slow" };

  return (
    <>
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
            onClick={() => {
              load();
              setTxs(null);
            }}
            title="Refresh"
            aria-label="Refresh"
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
          <SkeletonLines count={1} />
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
        <button type="button" className="mm-action" onClick={openSend}>
          <span className="ring">
            <ArrowUpRight size={19} />
          </span>
          Send
        </button>
      </div>

      {/* An unresolved broadcast sits above everything until it is dealt with. */}
      {ambiguous && (
        <div className="mm-drawer" style={{ padding: "0 16px 16px" }}>
          <Card title="A send is unconfirmed either way">
            <p className="muted small" style={{ marginTop: 0 }}>
              {ambiguous.message ||
                "The network did not confirm whether it accepted this transaction. It may still go through."}{" "}
              <strong>Do not send it again until you know.</strong>
            </p>
            <dl className="trade-quote">
              <div>
                <dt>To</dt>
                <dd>
                  <code className="wallet-address">{ambiguous.to}</code>
                </dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd className="num">{btc(ambiguous.amountSats)} BTC</dd>
              </div>
              {ambiguous.txid && (
                <div>
                  <dt>Transaction</dt>
                  <dd>
                    <a
                      className="linklike"
                      href={explorerTx(network, ambiguous.txid)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {ambiguous.txid.slice(0, 16)}... <ExternalLink size={12} />
                    </a>
                  </dd>
                </div>
              )}
            </dl>
            {ambiguous.found === false && (
              <p className="muted small">
                Checked at {new Date(ambiguous.checkedAt).toLocaleTimeString()}: not seen at this address
                yet. A transaction can take a minute to appear. If it is still absent after a few
                checks, it was not sent and you may try again.
              </p>
            )}
            <div className="row wrap" style={{ gap: 8 }}>
              <Button variant="primary" onClick={checkAmbiguous} loading={checking}>
                Check the address now
              </Button>
              {ambiguous.found === false && (
                <Button variant="ghost" onClick={() => setAmbiguous(null)}>
                  It is not there. Let me send again
                </Button>
              )}
            </div>
          </Card>
        </div>
      )}

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
            {/* The same disc the EVM wallet draws, from the same logo cache. This
                was a lettered "BTC" placeholder, the one kind of mark the owner
                asked never to see. */}
            <TokenLogo symbol="BTC" native />
            <span className="mm-row-main">
              <span className="mm-row-name">Bitcoin</span>
              <span className="mm-row-note">
                {isMainnet ? "Native segwit, bc1" : "Native segwit, tb1"}
              </span>
            </span>
            <span className="mm-row-right">
              <span className="mm-row-fiat">{balance ? `${btc(total)} BTC` : "Unknown"}</span>
              <span className="mm-row-qty">
                {balance ? `${sats(balance.confirmed)} sats confirmed` : "unreadable"}
              </span>
            </span>
          </div>
        </div>
      ) : (
        <div className="mm-list" style={{ padding: 14 }}>
          {lastSend && !lastSend.confirmed && (
            <div className="alert" role="status" style={{ marginBottom: 12 }}>
              <span className="grow">
                {lastSend.cancelled ? "Cancellation sent" : lastSend.replaced ? "Sped up" : "Sent"}.{" "}
                {btc(lastSend.amountSats)} BTC, fee {sats(lastSend.fee)} sats at {lastSend.feeRateSatPerVb}{" "}
                sat/vB. Waiting to confirm.{" "}
                <a
                  className="linklike"
                  href={explorerTx(network, lastSend.txid)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View <ExternalLink size={12} />
                </a>
              </span>
              {!bump && (
                <span className="row" style={{ gap: 6 }}>
                  <Button size="sm" onClick={() => startBump("speed")} title="Replace with a higher fee">
                    <Zap size={13} /> Speed up
                  </Button>
                  {!lastSend.cancelled && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => startBump("cancel")}
                      title="Replace with a payment back to this wallet"
                    >
                      <Ban size={13} /> Cancel
                    </Button>
                  )}
                </span>
              )}
            </div>
          )}

          {bump && lastSend && !lastSend.confirmed && (
            <form onSubmit={confirmBump} className="stack-sm" style={{ marginBottom: 14 }}>
              <p className="muted small" style={{ margin: 0 }}>
                {bump.mode === "cancel"
                  ? "This replaces the payment with one that returns the coins to this wallet. It works only while the original is unconfirmed, and the network keeps whichever it mines first."
                  : "This replaces the payment with an identical one at a higher fee. Same coins, same destination, same amount."}{" "}
                The original paid {lastSend.feeRateSatPerVb} sat/vB
                {fees && fees.network === network ? `; the network wants about ${fees.fast} right now` : ""}.
              </p>
              <Field label="New fee rate, satoshis per vbyte">
                <Input
                  value={bump.rate}
                  onChange={(e) => setBump((b) => ({ ...b, rate: e.target.value.replace(/[^\d.]/g, "") }))}
                  inputMode="decimal"
                />
              </Field>
              <Field label="Wallet password">
                <Input
                  type="password"
                  value={bump.password}
                  onChange={(e) => setBump((b) => ({ ...b, password: e.target.value }))}
                  autoComplete="current-password"
                />
              </Field>
              {bump.error && (
                <div className="alert alert-error" role="alert">
                  <TriangleAlert size={15} />
                  <span>{bump.error}</span>
                </div>
              )}
              <div className="row" style={{ gap: 8 }}>
                <Button variant="primary" type="submit" loading={bump.busy}>
                  {bump.mode === "cancel" ? "Sign the cancellation" : "Sign the replacement"}
                </Button>
                <Button variant="ghost" type="button" onClick={() => setBump(null)} disabled={bump.busy}>
                  Back
                </Button>
              </div>
            </form>
          )}

          {txs === null ? (
            <SkeletonLines count={3} />
          ) : txsError ? (
            <p className="muted small" style={{ margin: 0 }}>
              The history could not be loaded: {txsError}. This says nothing about your balance.
            </p>
          ) : txs.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              Nothing here yet. Transactions appear once they reach the mempool.
            </p>
          ) : (
            txs.slice(0, 12).map((t) => (
              <div className="mm-row" key={t.txid}>
                <span className="mm-row-main">
                  <a
                    className="mm-row-name num linklike"
                    style={{ fontSize: 12.5 }}
                    href={explorerTx(network, t.txid)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {String(t.txid).slice(0, 12)}...
                  </a>
                  <span className="mm-row-note">
                    {t.direction === "in" ? "Received" : "Sent"}
                    {t.confirmed ? `, confirmed in block ${t.blockHeight}` : ", waiting to confirm"}
                  </span>
                </span>
                <span className="mm-row-right">
                  <span className="mm-row-fiat num">{btc(Math.abs(t.valueDelta || 0))} BTC</span>
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
            title={step === "review" ? "Review before signing" : "Send Bitcoin"}
            action={
              <Button
                variant="ghost"
                icon
                title="Close"
                onClick={() => {
                  setPanel(null);
                  setStep("form");
                  setPlan(null);
                  setSendPassword("");
                }}
              >
                <X size={15} />
              </Button>
            }
          >
            {sendError && (
              <div className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>
                <TriangleAlert size={15} />
                <span>{sendError}</span>
              </div>
            )}

            {step === "form" && (
              <form onSubmit={review} className="stack-sm">
                <Field
                  label="To address"
                  error={destCheck && !destCheck.ok ? destCheck.reason : undefined}
                >
                  <Input
                    value={sendTo}
                    onChange={(e) => setSendTo(e.target.value)}
                    placeholder={isMainnet ? "bc1..." : "tb1..."}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
                {sendTo.trim() && sendTo.trim() === address && (
                  <p className="field-hint" style={{ margin: 0 }}>
                    That is this wallet's own address. Sending to it costs a fee and moves nothing.
                  </p>
                )}
                <Field label="Amount in BTC">
                  <Input
                    value={sendAmount}
                    onChange={(e) => setSendAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.001"
                    autoComplete="off"
                  />
                </Field>

                <Field label="Fee">
                  <div className="row wrap" style={{ gap: 6 }}>
                    {feeOptions.map((k) => {
                      const v = fees && fees.network === network ? Number(fees[k]) : null;
                      return (
                        <button
                          key={k}
                          type="button"
                          className={`chip${feeChoice === k ? " active" : ""}`}
                          onClick={() => setFeeChoice(k)}
                          disabled={!Number.isFinite(v)}
                        >
                          {feeLabel[k]}
                          {Number.isFinite(v) ? ` · ${v} sat/vB` : ""}
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <p className="muted caption" style={{ margin: 0 }}>
                  {fees && fees.network === network
                    ? `Rates for ${isMainnet ? "Bitcoin" : "Bitcoin testnet"}, fetched ${Math.max(
                        0,
                        Math.round((Date.now() - feesAt) / 1000)
                      )}s ago. `
                    : feesError
                      ? `Fee rates could not be fetched: ${feesError}. Sending waits until they can. `
                      : "Fetching the current network fee. "}
                  The fee goes to miners, not to us. Every send can be sped up or cancelled while it
                  is unconfirmed.
                </p>

                <Button
                  variant="primary"
                  type="submit"
                  loading={planning}
                  disabled={
                    Boolean(ambiguous) ||
                    !sendTo.trim() ||
                    !sendAmount.trim() ||
                    (destCheck && !destCheck.ok) ||
                    feeRate == null
                  }
                  block
                >
                  Review
                </Button>
              </form>
            )}

            {step === "review" && plan && (
              <form onSubmit={confirmSend} className="stack-sm">
                <dl className="trade-quote">
                  <div>
                    <dt>To</dt>
                    <dd>
                      <code className="wallet-address">{plan.toAddress}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Amount</dt>
                    <dd className="num">
                      {btc(plan.amountSats)} BTC <span className="muted">({sats(plan.amountSats)} sats)</span>
                    </dd>
                  </div>
                  <div>
                    <dt>Network fee</dt>
                    <dd className="num">
                      {sats(plan.fee)} sats{" "}
                      <span className="muted">
                        ({plan.feeRateSatPerVb} sat/vB, about {plan.vsize} vbytes)
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Leaves this wallet</dt>
                    <dd className="num mono-strong">{btc(plan.amountSats + plan.fee)} BTC</dd>
                  </div>
                  <div>
                    <dt>Coins used</dt>
                    <dd className="num">
                      {plan.inputs.length} input{plan.inputs.length === 1 ? "" : "s"} worth{" "}
                      {btc(plan.inputTotal)} BTC
                      {plan.hasChange
                        ? `, ${btc(plan.change)} BTC returns to this address`
                        : ", nothing returns as change"}
                    </dd>
                  </div>
                  {balance && (
                    <div>
                      <dt>Balance after</dt>
                      <dd className="num">
                        about {btc(Math.max(0, Number(total || 0) - plan.amountSats - plan.fee))} BTC
                      </dd>
                    </div>
                  )}
                </dl>
                <p className="muted caption" style={{ margin: 0 }}>
                  Bitcoin cannot be reversed. Check the address character by character. Signing
                  happens on this device with the password below, and the key is discarded straight
                  after.
                </p>
                <Field label="Wallet password">
                  <Input
                    type="password"
                    value={sendPassword}
                    onChange={(e) => setSendPassword(e.target.value)}
                    autoComplete="current-password"
                    autoFocus
                  />
                </Field>
                <div className="row" style={{ gap: 8 }}>
                  <Button variant="primary" type="submit" loading={sending} disabled={!sendPassword}>
                    Sign and send
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={sending}
                    onClick={() => {
                      setStep("form");
                      setPlan(null);
                      setSendPassword("");
                    }}
                  >
                    Back
                  </Button>
                </div>
              </form>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
