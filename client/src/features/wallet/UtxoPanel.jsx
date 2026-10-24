import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, Check, Copy, ExternalLink, KeyRound, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import http from "../../api/http";
import { Button, Field, Input, PageHeader, SkeletonLines } from "../../components/ui";
import { DetailPane } from "../../components/ui/Modal";
import { unlockWallet } from "./keystore";
import TokenLogo from "../../components/TokenLogo";
import { cacheChainAddress, ensureChainAddressRegistered, readChainAddress } from "./chainAddresses";
import { canDeriveUtxo, coinConfig, deriveUtxoAccount, deriveUtxoPrivateKey, formatUnits, parseUnits } from "./utxo/coins";
import { buildUtxoSpend, planUtxoSpend, validateUtxoDestination } from "./utxo/spend";

const PENDING_PREFIX = "ledgerwatch.wallet.utxo.pending";

function pendingKey(userId, coin, network) {
  return `${PENDING_PREFIX}.${coin}.${network}.${userId || "anon"}`;
}

function readPending(userId, coin, network) {
  try {
    const raw = localStorage.getItem(pendingKey(userId, coin, network));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writePending(userId, coin, network, value) {
  try {
    if (value) localStorage.setItem(pendingKey(userId, coin, network), JSON.stringify(value));
    else localStorage.removeItem(pendingKey(userId, coin, network));
  } catch {
    return;
  }
}

function reason(err) {
  return err?.response?.data?.error || err?.message || "the network did not answer";
}

export default function UtxoPanel({ userId, coin, network, evmAddress = null }) {
  const cfg = useMemo(() => coinConfig(coin, network), [coin, network]);
  const sym = cfg.net.symbol;
  const amountOf = (units) => `${formatUnits(units, cfg.decimals)} ${sym}`;

  const [address, setAddress] = useState(() => readChainAddress(userId, coin, network, evmAddress));
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [unwatched, setUnwatched] = useState(false);

  const [balance, setBalance] = useState(null);
  const [balError, setBalError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [txs, setTxs] = useState(null);
  const [txsError, setTxsError] = useState(null);
  const [tab, setTab] = useState("balance");
  const [panel, setPanel] = useState(null);

  const [fees, setFees] = useState(null);
  const [feesError, setFeesError] = useState(null);
  const [feeChoice, setFeeChoice] = useState("medium");
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendPassword, setSendPassword] = useState("");
  const [plan, setPlan] = useState(null);
  const [step, setStep] = useState("form");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState("");
  const [pending, setPending] = useState(() => readPending(userId, coin, network));

  const remember = useCallback(
    (next) => {
      setPending(next);
      writePending(userId, coin, network, next);
    },
    [userId, coin, network]
  );

  useEffect(() => {
    setAddress(readChainAddress(userId, coin, network, evmAddress));
    setBalance(null);
    setBalError(null);
    setTxs(null);
    setTxsError(null);
    setFees(null);
    setPanel(null);
    setStep("form");
    setPlan(null);
    setPending(readPending(userId, coin, network));
  }, [userId, coin, network, evmAddress]);

  const query = useCallback((extra) => ({ params: { coin, network, ...extra } }), [coin, network]);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const { data } = await http.get("/api/utxo/balance", query({ address }));
      setBalance(data);
      setBalError(null);
    } catch (err) {
      setBalance(null);
      setBalError(reason(err));
    } finally {
      setLoading(false);
    }
  }, [address, query]);

  const loadTxs = useCallback(async () => {
    if (!address) return null;
    try {
      const { data } = await http.get("/api/utxo/txs", query({ address }));
      setTxs(data.txs || []);
      setTxsError(null);
      return data.txs || [];
    } catch (err) {
      setTxsError(reason(err));
      return null;
    }
  }, [address, query]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (address) ensureChainAddressRegistered(coin, network, address).then((ok) => setUnwatched(!ok));
  }, [address, coin, network]);

  useEffect(() => {
    if (tab === "activity" && txs === null) loadTxs();
  }, [tab, txs, loadTxs]);

  useEffect(() => {
    if (!pending || pending.confirmed || !pending.txid) return undefined;
    const timer = setInterval(async () => {
      const list = await loadTxs();
      const hit = list && list.find((t) => t.txid === pending.txid);
      if (hit) {
        remember(hit.confirmed ? null : { ...pending, ambiguous: false, seen: true });
        load();
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [pending, loadTxs, load, remember]);

  async function setUp(e) {
    e.preventDefault();
    setError("");
    setUnlocking(true);
    try {
      const wallet = await unlockWallet(password);
      const phrase = wallet?.mnemonic?.phrase;
      const can = canDeriveUtxo(phrase, coin);
      if (!can.ok) return setError(can.reason);
      const account = deriveUtxoAccount(phrase, coin, network);
      cacheChainAddress(userId, coin, network, account.address, evmAddress || wallet.address);
      setAddress(account.address);
      setPassword("");
      setUnwatched(!(await ensureChainAddressRegistered(coin, network, account.address)));
    } catch (err) {
      setError(/invalid password/i.test(String(err?.message)) ? "That password did not unlock the wallet." : reason(err));
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
      setError("The address could not be copied. Select it on the Receive page instead.");
    }
  }

  async function refreshFees() {
    try {
      const { data } = await http.get("/api/utxo/fees", query({}));
      setFees(data);
      setFeesError(null);
    } catch (err) {
      setFees(null);
      setFeesError(reason(err));
    }
  }

  function openSend() {
    setPanel("send");
    setStep("form");
    setPlan(null);
    setSendError("");
    refreshFees();
  }

  const feeRate = fees && Number.isFinite(Number(fees[feeChoice])) ? Number(fees[feeChoice]) : null;
  const destCheck = sendTo.trim() ? validateUtxoDestination(sendTo, coin, network) : null;

  async function review(e) {
    e.preventDefault();
    setSendError("");
    if (pending && pending.ambiguous) {
      return setSendError("A previous send has not been resolved. Check it above before sending again, so you do not pay twice.");
    }
    if (!destCheck || !destCheck.ok) return setSendError((destCheck && destCheck.reason) || "Enter the address to send to.");
    if (sendTo.trim() === address) return setSendError("That is this wallet's own address. Sending to it costs a fee and moves nothing.");
    const amount = parseUnits(sendAmount, cfg.decimals);
    if (!amount) return setSendError(`Enter an amount in ${sym}, with at most ${cfg.decimals} decimal places.`);
    if (!feeRate) return setSendError(feesError ? `Fee rates could not be fetched: ${feesError}.` : "Fee rates are still loading.");

    setBusy(true);
    try {
      const { data } = await http.get("/api/utxo/utxos", query({ address }));
      if (data.truncated) {
        setSendError("This address holds more separate coins than can be listed at once, so only the largest ones are used.");
      }
      const next = planUtxoSpend({ coin, network, utxos: data.utxos, fromAddress: address, toAddress: sendTo, amount, feeRate });
      if (!next.ok) return setSendError(next.reason);
      setPlan(next);
      setStep("confirm");
    } catch (err) {
      setSendError(`Your coins could not be read: ${reason(err)}. Nothing was sent.`);
    } finally {
      setBusy(false);
    }
  }

  async function send(e) {
    e.preventDefault();
    setSendError("");
    if (!sendPassword) return setSendError("Enter your wallet password to sign.");
    setBusy(true);
    let built = null;
    let attempted = false;
    try {
      const wallet = await unlockWallet(sendPassword);
      const phrase = wallet?.mnemonic?.phrase;
      const can = canDeriveUtxo(phrase, coin);
      if (!can.ok) throw new Error(can.reason);
      if (deriveUtxoAccount(phrase, coin, network).address !== address) {
        throw new Error(`This wallet's ${cfg.label} address is not the one shown here, so nothing was signed. Set it up again.`);
      }

      const rawTxs = {};
      if (plan.needsRawInputs) {
        for (const u of plan.inputs) {
          const { data } = await http.get("/api/utxo/raw", query({ txid: u.txid }));
          rawTxs[u.txid] = data.hex;
        }
      }

      built = buildUtxoSpend({
        coin,
        network,
        utxos: plan.inputs,
        fromAddress: address,
        toAddress: plan.toAddress,
        amount: plan.amount,
        feeRate: plan.feeRate,
        privateKey: deriveUtxoPrivateKey(phrase, coin, network),
        rawTxs,
      });
      if (!built.ok) throw new Error(built.reason);

      attempted = true;
      const { data } = await http.post("/api/utxo/broadcast", { coin, network, rawTx: built.hex });
      remember({ txid: data.txid || built.txid, to: plan.toAddress, amount: plan.amount, fee: built.fee, at: Date.now(), ambiguous: false });
      setSendTo("");
      setSendAmount("");
      setPlan(null);
      setStep("form");
      setPanel(null);
      setTab("activity");
      setTxs(null);
      load();
    } catch (err) {
      const data = err?.response?.data;
      const lost = attempted && !err?.response;
      if ((data && (data.kind === "ambiguous" || data.resendUnsafe)) || lost) {
        remember({
          txid: built ? built.txid : null,
          to: plan.toAddress,
          amount: plan.amount,
          fee: built ? built.fee : plan.fee,
          at: Date.now(),
          ambiguous: true,
          message: lost ? "The transaction was signed and sent, and the connection dropped before the answer came back." : data.error,
        });
        setStep("form");
        setPlan(null);
        setPanel(null);
        return;
      }
      setSendError(/invalid password/i.test(String(err?.message)) ? "That wallet password is not right. Nothing was sent." : reason(err));
    } finally {
      setSendPassword("");
      setBusy(false);
    }
  }

  if (!address) {
    return (
      <div className="mm-hero" style={{ textAlign: "left", padding: "22px 20px" }}>
        <div className="mm-setup-mark" style={{ margin: "0 0 14px" }}>
          <KeyRound size={22} />
        </div>
        <h3 className="section-title" style={{ margin: "0 0 6px" }}>
          Unlock once to set up {cfg.label}
        </h3>
        <p className="muted small" style={{ margin: "0 0 14px", maxWidth: "46ch" }}>
          Your {cfg.label} account comes from the same recovery phrase as the rest of this wallet, so there is
          nothing new to write down. Enter your password once and the address is remembered on this device.
          Sending always asks again.
        </p>
        {error && (
          <div className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>
            <TriangleAlert size={15} />
            <span>{error}</span>
          </div>
        )}
        <form onSubmit={setUp} className="stack-sm">
          <Field label="Wallet password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          <Button variant="primary" type="submit" loading={unlocking} block>
            Set up {cfg.label}
          </Button>
        </form>
      </div>
    );
  }

  const total = balance ? Number(balance.total ?? Number(balance.confirmed || 0) + Number(balance.pending || 0)) : null;
  const feeLabel = { fast: "Fast", medium: "Normal", slow: "Slow" };

  return (
    <>
      <section className="card mm">
        <div className="mm-top">
          <button type="button" className="mm-acct" onClick={copyAddr} title={`Copy your ${cfg.label} address`}>
            <span className="addr num" style={{ fontSize: 12 }}>
              {address.slice(0, 10)}...{address.slice(-6)}
            </span>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <div className="mm-icons">
            <button type="button" className="mm-icon" onClick={() => { load(); setTxs(null); }} title="Refresh" aria-label="Refresh">
              <RefreshCw size={15} className={loading ? "spin" : undefined} />
            </button>
          </div>
        </div>

        <div className="mm-hero">
          {balance ? (
            <>
              <span className="mm-fiat">{amountOf(total)}</span>
              <span className="mm-sub">
                {cfg.label}
                {network === "mainnet" ? "" : ` ${network}`}
                {Number(balance.pending) > 0 ? `, ${amountOf(balance.pending)} still confirming` : ""}
              </span>
            </>
          ) : loading ? (
            <SkeletonLines count={1} />
          ) : (
            <>
              <span className="mm-fiat" style={{ fontSize: 24 }}>Balance unavailable</span>
              <span className="mm-caveat">
                {balError}. This is a connection problem rather than an empty wallet, so your coins are untouched.
              </span>
            </>
          )}
        </div>

        <div className="mm-actions">
          <button type="button" className="btn" onClick={openSend} disabled={!balance || total <= 0}>
            <ArrowUpRight size={16} />
            Send
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setPanel(panel === "receive" ? null : "receive")}>
            <ArrowDownToLine size={16} />
            Receive
          </button>
        </div>

        {unwatched && (
          <p className="muted small" style={{ margin: "0 16px 12px" }}>
            This address could not be registered for notifications just now. It works normally; it will be registered the next time it is set up.
          </p>
        )}

        {pending && (
          <div className="against-note" style={{ margin: "0 16px 12px" }}>
            <TriangleAlert size={15} />
            <span className="stack-sm">
              <span>
                {pending.ambiguous
                  ? `${pending.message || "The network did not confirm whether it accepted your last send."} Check before sending again so you do not pay twice.`
                  : `Your send of ${amountOf(pending.amount)} is waiting to confirm.`}
              </span>
              {pending.txid && (
                <a className="tx-hash-link" href={`${cfg.net.explorerTx}${pending.txid}`} target="_blank" rel="noopener noreferrer">
                  {pending.txid.slice(0, 12)}… <ExternalLink size={12} />
                </a>
              )}
              {pending.ambiguous && (
                <span className="row wrap">
                  <Button size="sm" onClick={() => loadTxs()}>Check again</Button>
                  <Button size="sm" variant="ghost" onClick={() => remember(null)}>
                    I checked the explorer and it did not go through
                  </Button>
                </span>
              )}
            </span>
          </div>
        )}

        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "balance"} className="tab" onClick={() => setTab("balance")}>
            Holdings
          </button>
          <button type="button" role="tab" aria-selected={tab === "activity"} className="tab" onClick={() => setTab("activity")}>
            Activity
          </button>
        </div>

        {tab === "balance" ? (
          <div className="mm-list">
            <div className="mm-row">
              <TokenLogo symbol={cfg.symbol} native />
              <span className="mm-row-main">
                <span className="mm-row-name">{cfg.label}</span>
                <span className="mm-row-note">{cfg.script === "p2wpkh" ? `Native segwit, ${cfg.net.prefix}` : `Standard address, ${cfg.net.prefix}`}</span>
              </span>
              <span className="mm-row-right">
                <span className="mm-row-fiat">{balance ? amountOf(total) : "Unknown"}</span>
              </span>
            </div>
          </div>
        ) : (
          <div className="mm-list">
            {txsError ? (
              <p className="error-text small" style={{ margin: 0 }}>Activity could not be loaded: {txsError}.</p>
            ) : txs === null ? (
              <SkeletonLines count={3} />
            ) : txs.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>Nothing here yet. Transactions appear once they reach the network.</p>
            ) : (
              txs.slice(0, 15).map((t) => (
                <div className="mm-row" key={t.txid}>
                  <span className="mm-row-main">
                    <a className="mm-row-name num linklike" style={{ fontSize: 12.5 }} href={`${cfg.net.explorerTx}${t.txid}`} target="_blank" rel="noopener noreferrer">
                      {String(t.txid).slice(0, 12)}...
                    </a>
                    <span className="mm-row-note">
                      {t.direction === "in" ? "Received" : "Sent"}
                      {t.confirmed ? `, confirmed in block ${t.blockHeight}` : ", waiting to confirm"}
                    </span>
                  </span>
                  <span className="mm-row-right">
                    <span className="mm-row-fiat num">{amountOf(Math.abs(t.valueDelta || 0))}</span>
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {panel === "receive" && (
        <DetailPane view="receive" crumb={`Receive ${cfg.label}`} label={`Receive ${cfg.label}`} onBack={() => setPanel(null)}>
          <PageHeader title={`Receive ${cfg.label}`} />
          <section className="card stack-sm">
            <p className="muted small" style={{ marginTop: 0 }}>
              Send only {cfg.label} to this address, on the {cfg.label}{network === "mainnet" ? "" : ` ${network}`} network. Coins sent
              from any other network will not arrive.
            </p>
            <code className="reveal-key" style={{ wordBreak: "break-all" }}>{address}</code>
            <div className="row wrap">
              <Button onClick={copyAddr}>{copied ? <Check size={14} /> : <Copy size={14} />} Copy address</Button>
              <a className="btn" href={`${cfg.net.explorerAddress}${address}`} target="_blank" rel="noopener noreferrer">
                View on explorer <ExternalLink size={14} />
              </a>
            </div>
          </section>
        </DetailPane>
      )}

      {panel === "send" && (
        <DetailPane view="send" crumb={`Send ${cfg.label}`} label={`Send ${cfg.label}`} onBack={() => setPanel(null)}>
          <PageHeader title={`Send ${cfg.label}`} />
          <section className="card">
            {sendError && (
              <div className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>
                <TriangleAlert size={15} />
                <span>{sendError}</span>
              </div>
            )}
            {step === "form" ? (
              <form onSubmit={review} className="stack-sm">
                <Field label="To address" error={destCheck && !destCheck.ok ? destCheck.reason : undefined}>
                  <Input value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder={`${cfg.net.prefix}...`} autoComplete="off" spellCheck={false} />
                </Field>
                <Field label={`Amount in ${sym}`}>
                  <Input value={sendAmount} onChange={(e) => setSendAmount(e.target.value)} inputMode="decimal" autoComplete="off" />
                </Field>
                <Field label="Fee">
                  <div className="row wrap" style={{ gap: 6 }}>
                    {["fast", "medium", "slow"].map((k) => {
                      const v = fees ? Number(fees[k]) : null;
                      return (
                        <button key={k} type="button" className={`chip${feeChoice === k ? " active" : ""}`} onClick={() => setFeeChoice(k)} disabled={!Number.isFinite(v)}>
                          {feeLabel[k]}
                          {Number.isFinite(v) ? ` · ${v} ${cfg.rateUnit}` : ""}
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <p className="muted caption" style={{ margin: 0 }}>
                  {feesError ? `Fee rates could not be fetched: ${feesError}. Sending waits until they can. ` : fees ? "" : "Fetching the current network fee. "}
                  The fee goes to the network, not to us.{cfg.rbf ? "" : ` ${cfg.label} payments cannot be sped up once sent, so the fee is chosen now.`}
                </p>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <Button variant="primary" type="submit" loading={busy}>Review</Button>
                </div>
              </form>
            ) : (
              <form onSubmit={send} className="stack-sm">
                <dl className="trade-quote">
                  <div>
                    <dt>Sending</dt>
                    <dd className="num">{amountOf(plan.amount)}</dd>
                  </div>
                  <div>
                    <dt>To</dt>
                    <dd className="num sweep-dest">{plan.toAddress}</dd>
                  </div>
                  <div>
                    <dt>Network fee</dt>
                    <dd className="num">
                      {amountOf(plan.fee)}
                      <span className="quote-sub">{plan.feeRate} {cfg.rateUnit}, about {plan.size} bytes</span>
                    </dd>
                  </div>
                  <div>
                    <dt>Total leaving this wallet</dt>
                    <dd className="num mono-strong">{amountOf(plan.amount + plan.fee)}</dd>
                  </div>
                </dl>
                <Field label="Wallet password">
                  <Input type="password" value={sendPassword} onChange={(e) => setSendPassword(e.target.value)} autoComplete="current-password" />
                </Field>
                <p className="settings-note">
                  <ShieldCheck size={15} />
                  Signed here on your device. The password is used once and discarded.
                </p>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <Button variant="ghost" onClick={() => { setStep("form"); setPlan(null); }} disabled={busy}>
                    Back
                  </Button>
                  <Button variant="primary" type="submit" loading={busy}>Sign and send</Button>
                </div>
              </form>
            )}
          </section>
        </DetailPane>
      )}
    </>
  );
}
