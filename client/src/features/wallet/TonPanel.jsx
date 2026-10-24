import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "ethers";
import { ArrowDownToLine, ArrowUpRight, Check, Copy, ExternalLink, KeyRound, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import http from "../../api/http";
import { Button, Field, Input, PageHeader, Select, SkeletonLines } from "../../components/ui";
import { DetailPane } from "../../components/ui/Modal";
import TokenLogo from "../../components/TokenLogo";
import { unlockWallet } from "./keystore";
import { cacheChainAddress, ensureChainAddressRegistered, readChainAddress } from "./chainAddresses";

const FEE_RESERVE = 20000000n;
const JETTON_VALUE = 50000000n;
const WAIT_TRIES = 60;

function reason(err) {
  return err?.response?.data?.error || err?.message || "the network did not answer";
}

function tonText(nano) {
  return `${formatUnits(BigInt(nano || 0), 9)} TON`;
}

function explorer(network, path) {
  return `${network === "mainnet" ? "https://tonviewer.com/" : "https://testnet.tonviewer.com/"}${path}`;
}

async function tonKit() {
  return import("./ton/ton.js");
}

export default function TonPanel({ userId, network, evmAddress = null }) {
  const [address, setAddress] = useState(() => readChainAddress(userId, "ton", network, evmAddress));
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [account, setAccount] = useState(null);
  const [accError, setAccError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("balance");
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [panel, setPanel] = useState(null);

  const [asset, setAsset] = useState("TON");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [validTo, setValidTo] = useState(null);
  const [sendPassword, setSendPassword] = useState("");
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState("");
  const [last, setLast] = useState(null);

  useEffect(() => {
    setAddress(readChainAddress(userId, "ton", network, evmAddress));
    setAccount(null);
    setHistory(null);
    setPanel(null);
    setPlan(null);
    setLast(null);
  }, [userId, network, evmAddress]);

  useEffect(() => {
    let alive = true;
    const t = to.trim();
    if (!t) {
      setValidTo(null);
      return undefined;
    }
    tonKit().then((k) => alive && setValidTo(k.isTonAddress(t)));
    return () => {
      alive = false;
    };
  }, [to]);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const { data } = await http.get("/api/ton/account", { params: { address, network } });
      setAccount(data);
      setAccError(null);
    } catch (err) {
      setAccount(null);
      setAccError(reason(err));
    } finally {
      setLoading(false);
    }
  }, [address, network]);

  const loadHistory = useCallback(async () => {
    try {
      const { data } = await http.get("/api/ton/history", { params: { address, network } });
      setHistory(data.items || []);
      setHistoryError(data.partial ? "Part of the history could not be loaded just now." : null);
    } catch (err) {
      setHistoryError(reason(err));
    }
  }, [address, network]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (address) ensureChainAddressRegistered("ton", network, address);
  }, [address, network]);

  useEffect(() => {
    if (tab === "activity" && history === null && address) loadHistory();
  }, [tab, history, address, loadHistory]);

  useEffect(() => {
    if (!last || last.settled) return undefined;
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      try {
        const { data } = await http.get("/api/ton/seqno", { params: { address, network } });
        if (data.deployed && data.seqno > last.seqno) {
          setLast((l) => ({ ...l, settled: true }));
          load();
          setHistory(null);
          clearInterval(timer);
          return;
        }
      } catch {
        return;
      }
      if (tries >= WAIT_TRIES) {
        setLast((l) => ({ ...l, settled: true, expired: true }));
        clearInterval(timer);
      }
    }, 6000);
    return () => clearInterval(timer);
  }, [last, address, network, load]);

  const usdt = useMemo(() => ((account && account.tokens) || [])[0] || null, [account]);

  async function setUp(e) {
    e.preventDefault();
    setError("");
    setUnlocking(true);
    try {
      const wallet = await unlockWallet(password);
      const phrase = wallet?.mnemonic?.phrase;
      if (!phrase) throw new Error("This wallet was imported from a bare private key, so it has no recovery phrase and no TON account can be derived from it.");
      const k = await tonKit();
      const acct = k.deriveTonAccount(phrase, network);
      cacheChainAddress(userId, "ton", network, acct.address, evmAddress || wallet.address);
      setAddress(acct.address);
      setPassword("");
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

  async function review(e) {
    e.preventDefault();
    setSendError("");
    if (last && !last.settled) return setSendError("Your last transfer has not been processed yet. Wait for it before sending again.");
    const k = await tonKit();
    let dest;
    try {
      dest = k.parseTonAddress(to);
    } catch (err) {
      return setSendError(err.message);
    }
    if (dest.testOnly !== (network === "testnet")) {
      return setSendError(network === "testnet" ? "That address is a mainnet address, and this is the TON testnet." : "That address is a testnet address. Sending real TON to it could lose it.");
    }
    if (dest.address.toRawString() === k.parseTonAddress(address).address.toRawString()) return setSendError("That is this wallet's own address.");
    const decimals = asset === "TON" ? 9 : usdt ? usdt.decimals : 6;
    let units;
    try {
      units = parseUnits(String(amount).trim(), decimals);
    } catch {
      return setSendError(`Enter an amount with at most ${decimals} decimal places.`);
    }
    if (units <= 0n) return setSendError("The amount must be more than zero.");
    if (!account) return setSendError("Your balance has not loaded yet.");
    const balance = BigInt(account.nanotons || 0);

    setBusy(true);
    try {
      const { data: r } = await http.get("/api/ton/recipient", { params: { address: to.trim(), network } });
      if (asset === "TON") {
        if (balance < units + FEE_RESERVE) {
          return setSendError(`Sending ${tonText(units)} needs about ${tonText(units + FEE_RESERVE)} including the network fee, and this wallet holds ${tonText(balance)}.`);
        }
        setPlan({ asset, to: to.trim(), units, bounce: dest.bounceable && r.active, recipientActive: r.active, memo: memo.trim() });
      } else {
        if (!usdt || usdt.amount == null) return setSendError("Your USDT balance could not be read, so nothing can be sent yet.");
        if (!usdt.jettonWallet || BigInt(usdt.amount) < units) return setSendError(`This wallet holds ${formatUnits(BigInt(usdt.amount || 0), usdt.decimals)} USDT.`);
        if (balance < JETTON_VALUE + FEE_RESERVE) {
          return setSendError(`A USDT transfer needs about ${tonText(JETTON_VALUE + FEE_RESERVE)} in TON for its fees, most of which comes back, and this wallet holds ${tonText(balance)}.`);
        }
        setPlan({ asset, to: to.trim(), units, token: usdt, recipientActive: r.active, memo: memo.trim() });
      }
    } catch (err) {
      setSendError(`The transfer could not be prepared: ${reason(err)}. Nothing was sent.`);
    } finally {
      setBusy(false);
    }
  }

  async function send(e) {
    e.preventDefault();
    setSendError("");
    if (!sendPassword) return setSendError("Enter your wallet password to sign.");
    setBusy(true);
    try {
      const wallet = await unlockWallet(sendPassword);
      const phrase = wallet?.mnemonic?.phrase;
      if (!phrase) throw new Error("This wallet has no recovery phrase, so it cannot sign for TON.");
      const k = await tonKit();
      const acct = k.deriveTonAccount(phrase, network);
      if (acct.address !== address) throw new Error("This wallet's TON address is not the one shown here, so nothing was signed.");
      const { data: s } = await http.get("/api/ton/seqno", { params: { address, network } });
      const built =
        plan.asset === "TON"
          ? k.buildTonTransfer({ account: acct, deployed: s.deployed, seqno: s.seqno, to: plan.to, bounce: plan.bounce, nanotons: plan.units, memo: plan.memo })
          : k.buildJettonTransfer({ account: acct, deployed: s.deployed, seqno: s.seqno, jettonWallet: plan.token.jettonWallet, to: plan.to, amount: plan.units, memo: plan.memo });
      await http.post("/api/ton/send", { boc: built.boc, network });
      setLast({ seqno: s.deployed ? s.seqno : -1, asset: plan.asset, units: plan.units, to: plan.to, settled: false });
      setPlan(null);
      setTo("");
      setAmount("");
      setMemo("");
      setPanel(null);
      setTab("activity");
    } catch (err) {
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
        <h3 className="section-title" style={{ margin: "0 0 6px" }}>Unlock once to set up TON</h3>
        <p className="muted small" style={{ margin: "0 0 14px", maxWidth: "46ch" }}>
          Your TON wallet comes from the same recovery phrase as the rest of this wallet, as a standard v4R2 wallet on the path
          multi-coin wallets use. The phrase is not a TON-only phrase, so wallets that accept only TON phrases cannot import it.
          Sending always asks for your password again.
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
          <Button variant="primary" type="submit" loading={unlocking} block>Set up TON</Button>
        </form>
      </div>
    );
  }

  return (
    <>
      <section className="card mm">
        <div className="mm-top">
          <button type="button" className="mm-acct" onClick={copyAddr} title="Copy your TON address">
            <span className="addr num" style={{ fontSize: 12 }}>{address.slice(0, 8)}...{address.slice(-6)}</span>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <div className="mm-icons">
            <button type="button" className="mm-icon" onClick={() => { load(); setHistory(null); }} title="Refresh" aria-label="Refresh">
              <RefreshCw size={15} className={loading ? "spin" : undefined} />
            </button>
          </div>
        </div>

        <div className="mm-hero">
          {account ? (
            <>
              <span className="mm-fiat">{tonText(account.nanotons)}</span>
              <span className="mm-sub">
                {network === "mainnet" ? "TON" : "TON testnet"}
                {account.deployed ? "" : ", wallet not yet deployed: your first send deploys it"}
              </span>
            </>
          ) : loading ? (
            <SkeletonLines count={1} />
          ) : (
            <>
              <span className="mm-fiat" style={{ fontSize: 24 }}>Balance unavailable</span>
              <span className="mm-caveat">{accError}. This is a connection problem rather than an empty wallet.</span>
            </>
          )}
        </div>

        <div className="mm-actions">
          <button type="button" className="btn" onClick={() => { setPanel("send"); setPlan(null); setSendError(""); }} disabled={!account}>
            <ArrowUpRight size={16} />
            Send
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setPanel(panel === "receive" ? null : "receive")}>
            <ArrowDownToLine size={16} />
            Receive
          </button>
        </div>

        {last && (
          <div className="against-note" style={{ margin: "0 16px 12px" }}>
            <TriangleAlert size={15} />
            <span className="stack-sm">
              <span>
                {!last.settled
                  ? "Your transfer was sent and is waiting for the wallet to process it. Sending it again could never pay twice."
                  : last.expired
                    ? "Your transfer was not processed within its five minute window, so it expired and nothing was taken."
                    : "Your wallet processed the transfer."}
              </span>
              <a className="tx-hash-link" href={explorer(network, address)} target="_blank" rel="noopener noreferrer">
                See it on the explorer <ExternalLink size={12} />
              </a>
            </span>
          </div>
        )}

        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "balance"} className="tab" onClick={() => setTab("balance")}>Holdings</button>
          <button type="button" role="tab" aria-selected={tab === "activity"} className="tab" onClick={() => setTab("activity")}>Activity</button>
        </div>

        {tab === "balance" ? (
          <div className="mm-list">
            <div className="mm-row">
              <TokenLogo symbol="TON" native />
              <span className="mm-row-main">
                <span className="mm-row-name">Toncoin</span>
                <span className="mm-row-note">Pays every fee on TON</span>
              </span>
              <span className="mm-row-right">
                <span className="mm-row-fiat">{account ? tonText(account.nanotons) : "Unknown"}</span>
              </span>
            </div>
            {usdt && (
              <div className="mm-row">
                <TokenLogo symbol="USDT" />
                <span className="mm-row-main">
                  <span className="mm-row-name">{usdt.name}</span>
                  <span className="mm-row-note">Jetton</span>
                </span>
                <span className="mm-row-right">
                  <span className="mm-row-fiat">{usdt.amount == null ? "Unknown" : `${formatUnits(BigInt(usdt.amount), usdt.decimals)} USDT`}</span>
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="mm-list">
            {historyError && <p className="muted small" style={{ margin: 0 }}>{historyError}</p>}
            {history === null && !historyError ? (
              <SkeletonLines count={3} />
            ) : (history || []).length === 0 ? (
              !historyError && <p className="muted small" style={{ margin: 0 }}>Nothing here yet.</p>
            ) : (
              history.map((t, i) => (
                <div className="mm-row" key={`${t.hash}-${t.symbol}-${i}`}>
                  <span className="mm-row-main">
                    <span className="mm-row-name">{BigInt(t.delta) >= 0n ? "Received" : "Sent"}{t.success === false ? ", failed" : ""}</span>
                    <span className="mm-row-note">{t.at ? new Date(t.at).toLocaleString() : ""}</span>
                  </span>
                  <span className="mm-row-right">
                    <span className="mm-row-fiat num">
                      {formatUnits(BigInt(t.delta), t.decimals)} {t.symbol}
                    </span>
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {panel === "receive" && (
        <DetailPane view="receive" crumb="Receive on TON" label="Receive on TON" onBack={() => setPanel(null)}>
          <PageHeader title="Receive TON or USDT" />
          <section className="card stack-sm">
            <p className="muted small" style={{ marginTop: 0 }}>
              Send only Toncoin or TON jettons to this address, on the TON{network === "mainnet" ? "" : " test"} network. USDT sent on
              another network will not arrive here. This is the non-bounceable form, which is right for a wallet that has not been used yet.
            </p>
            <code className="reveal-key" style={{ wordBreak: "break-all" }}>{address}</code>
            <div className="row wrap">
              <Button onClick={copyAddr}>{copied ? <Check size={14} /> : <Copy size={14} />} Copy address</Button>
              <a className="btn" href={explorer(network, address)} target="_blank" rel="noopener noreferrer">
                View on explorer <ExternalLink size={14} />
              </a>
            </div>
          </section>
        </DetailPane>
      )}

      {panel === "send" && (
        <DetailPane view="send" crumb="Send on TON" label="Send on TON" onBack={() => setPanel(null)}>
          <PageHeader title="Send on TON" />
          <section className="card">
            {sendError && (
              <div className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>
                <TriangleAlert size={15} />
                <span>{sendError}</span>
              </div>
            )}
            {!plan ? (
              <form onSubmit={review} className="stack-sm">
                <Field label="Asset">
                  <Select value={asset} onChange={(e) => setAsset(e.target.value)}>
                    <option value="TON">TON</option>
                    {usdt && <option value="USDT">USDT</option>}
                  </Select>
                </Field>
                <Field label="To address" error={validTo === false ? "That is not a valid TON address." : undefined}>
                  <Input value={to} onChange={(e) => setTo(e.target.value)} autoComplete="off" spellCheck={false} />
                </Field>
                <Field label={`Amount in ${asset}`}>
                  <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoComplete="off" />
                </Field>
                <Field label="Comment, if the recipient asks for one">
                  <Input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={120} autoComplete="off" />
                </Field>
                <p className="muted caption" style={{ margin: 0 }}>Exchanges usually need a comment to credit a deposit. Leave it empty for a person's wallet.</p>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <Button variant="primary" type="submit" loading={busy}>Review</Button>
                </div>
              </form>
            ) : (
              <form onSubmit={send} className="stack-sm">
                <dl className="trade-quote">
                  <div>
                    <dt>Sending</dt>
                    <dd className="num">{formatUnits(plan.units, plan.asset === "TON" ? 9 : plan.token.decimals)} {plan.asset}</dd>
                  </div>
                  <div>
                    <dt>To</dt>
                    <dd className="num sweep-dest">
                      {plan.to}
                      {!plan.recipientActive && <span className="quote-sub">this wallet has never been used; the transfer is sent so that it cannot bounce back</span>}
                    </dd>
                  </div>
                  {plan.memo && (
                    <div>
                      <dt>Comment</dt>
                      <dd>{plan.memo}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Network fee</dt>
                    <dd className="num">
                      {plan.asset === "TON" ? `about ${tonText(FEE_RESERVE / 2n)}` : `${tonText(JETTON_VALUE)} attached`}
                      <span className="quote-sub">
                        {plan.asset === "TON" ? "paid from your TON on top of the amount" : "covers the token transfer; what is not used comes back to you"}
                      </span>
                    </dd>
                  </div>
                </dl>
                <Field label="Wallet password">
                  <Input type="password" value={sendPassword} onChange={(e) => setSendPassword(e.target.value)} autoComplete="current-password" />
                </Field>
                <p className="settings-note">
                  <ShieldCheck size={15} />
                  Built and signed here on your device. The message expires after five minutes if the network has not taken it.
                </p>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <Button variant="ghost" onClick={() => setPlan(null)} disabled={busy}>Back</Button>
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
