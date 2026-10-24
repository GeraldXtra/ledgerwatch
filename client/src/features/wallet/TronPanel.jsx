import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "ethers";
import { ArrowDownToLine, ArrowUpRight, Check, Copy, ExternalLink, KeyRound, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import http from "../../api/http";
import { Button, Field, Input, PageHeader, Select, SkeletonLines } from "../../components/ui";
import { DetailPane } from "../../components/ui/Modal";
import TokenLogo from "../../components/TokenLogo";
import { unlockWallet } from "./keystore";
import { cacheChainAddress, ensureChainAddressRegistered, readChainAddress } from "./chainAddresses";
import { buildTronTransfer, buildTrc20Transfer, deriveTronAccount, isTronAddress } from "./tron/tron";

const EXPLORER = {
  mainnet: { tx: "https://tronscan.org/#/transaction/", address: "https://tronscan.org/#/address/" },
  testnet: { tx: "https://nile.tronscan.org/#/transaction/", address: "https://nile.tronscan.org/#/address/" },
};
const TRANSFER_BYTES = 270;

function reason(err) {
  return err?.response?.data?.error || err?.message || "the network did not answer";
}

function trx(sun) {
  return `${formatUnits(BigInt(sun || 0), 6)} TRX`;
}

export default function TronPanel({ userId, network, evmAddress = null }) {
  const [address, setAddress] = useState(() => readChainAddress(userId, "tron", network, evmAddress));
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

  const [asset, setAsset] = useState("TRX");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [sendPassword, setSendPassword] = useState("");
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState("");
  const [last, setLast] = useState(null);

  useEffect(() => {
    setAddress(readChainAddress(userId, "tron", network, evmAddress));
    setAccount(null);
    setHistory(null);
    setPanel(null);
    setPlan(null);
    setLast(null);
  }, [userId, network, evmAddress]);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const { data } = await http.get("/api/tron/account", { params: { address, network } });
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
      const { data } = await http.get("/api/tron/history", { params: { address, network } });
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
    if (address) ensureChainAddressRegistered("tron", network, address);
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
        const { data } = await http.get("/api/tron/tx", { params: { txid: last.txid, network } });
        if (data.found) {
          setLast((l) => ({ ...l, settled: true, success: data.success, result: data.result }));
          load();
          setHistory(null);
        }
      } catch {
        if (tries > 40) setLast((l) => ({ ...l, settled: true, unknown: true }));
      }
      if (tries > 40) clearInterval(timer);
    }, 5000);
    return () => clearInterval(timer);
  }, [last, network, load]);

  const usdt = account && account.tokens && account.tokens[0];

  async function setUp(e) {
    e.preventDefault();
    setError("");
    setUnlocking(true);
    try {
      const wallet = await unlockWallet(password);
      const phrase = wallet?.mnemonic?.phrase;
      if (!phrase) throw new Error("This wallet was imported from a bare private key, so it has no recovery phrase and no Tron account can be derived from it.");
      const acct = deriveTronAccount(phrase);
      cacheChainAddress(userId, "tron", network, acct.address, evmAddress || wallet.address);
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
    if (!isTronAddress(to)) return setSendError("That is not a Tron address, or it has a typing mistake. A Tron address starts with T.");
    if (to.trim() === address) return setSendError("That is this wallet's own address.");
    let units;
    try {
      units = parseUnits(String(amount).trim(), 6);
    } catch {
      return setSendError("Enter an amount with at most 6 decimal places.");
    }
    if (units <= 0n) return setSendError("The amount must be more than zero.");
    if (!account) return setSendError("Your balance has not loaded yet.");
    const balanceSun = BigInt(account.balanceSun || 0);

    setBusy(true);
    try {
      const [{ data: params }, { data: dest }] = await Promise.all([
        http.get("/api/tron/params", { params: { network } }),
        http.get("/api/tron/account", { params: { address: to.trim(), network } }),
      ]);
      const freeBandwidth = Number(account.bandwidth?.free || 0) + Number(account.bandwidth?.staked || 0);
      const bandwidthSun = freeBandwidth >= TRANSFER_BYTES ? 0n : BigInt(TRANSFER_BYTES * Number(params.bandwidthFee || 1000));

      if (asset === "TRX") {
        const activation = dest.exists ? 0n : BigInt(params.createAccountFee || 1000000) + BigInt(params.createAccountBandwidthFee || 100000);
        const fee = bandwidthSun + activation;
        if (balanceSun < units + fee) {
          return setSendError(`Sending ${trx(units)} needs ${trx(units + fee)} including fees, and this account holds ${trx(balanceSun)}.`);
        }
        setPlan({ asset, to: to.trim(), units, fee, activation, newAccount: !dest.exists });
      } else {
        if (!usdt || usdt.balance == null) return setSendError("Your USDT balance could not be read, so nothing can be sent yet.");
        if (BigInt(usdt.balance) < units) return setSendError(`This account holds ${formatUnits(BigInt(usdt.balance), 6)} USDT.`);
        const { data: est } = await http.get("/api/tron/estimate", { params: { owner: address, to: to.trim(), amount: units.toString(), network } });
        const feeLimit = BigInt(est.feeLimit);
        if (balanceSun < feeLimit + bandwidthSun) {
          return setSendError(
            `A USDT transfer burns TRX for energy. This one can cost up to ${trx(feeLimit + bandwidthSun)}, and this account holds ${trx(balanceSun)}. Add TRX first, or the transfer could fail part way and still burn its fee.`
          );
        }
        setPlan({ asset, to: to.trim(), units, fee: feeLimit + bandwidthSun, feeLimit, energy: est.energy, token: est.token });
      }
    } catch (err) {
      setSendError(`The transfer could not be priced: ${reason(err)}. Nothing was sent.`);
    } finally {
      setBusy(false);
    }
  }

  async function send(e) {
    e.preventDefault();
    setSendError("");
    if (!sendPassword) return setSendError("Enter your wallet password to sign.");
    setBusy(true);
    let txid = null;
    let attempted = false;
    try {
      const wallet = await unlockWallet(sendPassword);
      const phrase = wallet?.mnemonic?.phrase;
      if (!phrase) throw new Error("This wallet has no recovery phrase, so it cannot sign for Tron.");
      const acct = deriveTronAccount(phrase);
      if (acct.address !== address) throw new Error("This wallet's Tron address is not the one shown here, so nothing was signed.");
      const { data: b } = await http.get("/api/tron/block", { params: { network } });
      const built =
        plan.asset === "TRX"
          ? buildTronTransfer({ block: b.block, owner: address, to: plan.to, amountSun: plan.units, privateKey: acct.privateKey })
          : buildTrc20Transfer({ block: b.block, owner: address, token: plan.token.address, to: plan.to, amount: plan.units, feeLimit: Number(plan.feeLimit), privateKey: acct.privateKey });
      txid = built.txid;
      attempted = true;
      const { data } = await http.post("/api/tron/broadcast", { hex: built.hex, network });
      setLast({ txid: data.txid || txid, asset: plan.asset, units: plan.units, to: plan.to, settled: false });
      setPlan(null);
      setTo("");
      setAmount("");
      setPanel(null);
      setTab("activity");
    } catch (err) {
      const data = err?.response?.data;
      if ((data && data.resendUnsafe) || (attempted && !err?.response)) {
        setLast({ txid, asset: plan.asset, units: plan.units, to: plan.to, settled: false, ambiguous: true, message: data?.error });
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

  const explorer = EXPLORER[network] || EXPLORER.mainnet;
  const holdings = useMemo(
    () => [
      { symbol: "TRX", name: "TRON", amount: account ? trx(account.balanceSun) : "Unknown" },
      { symbol: "USDT", name: "Tether USD", amount: usdt && usdt.balance != null ? `${formatUnits(BigInt(usdt.balance), 6)} USDT` : "Unknown" },
    ],
    [account, usdt]
  );

  if (!address) {
    return (
      <div className="mm-hero" style={{ textAlign: "left", padding: "22px 20px" }}>
        <div className="mm-setup-mark" style={{ margin: "0 0 14px" }}>
          <KeyRound size={22} />
        </div>
        <h3 className="section-title" style={{ margin: "0 0 6px" }}>Unlock once to set up Tron</h3>
        <p className="muted small" style={{ margin: "0 0 14px", maxWidth: "46ch" }}>
          Your Tron account comes from the same recovery phrase as the rest of this wallet. Enter your password once and the
          address is remembered on this device. Sending always asks again.
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
          <Button variant="primary" type="submit" loading={unlocking} block>Set up Tron</Button>
        </form>
      </div>
    );
  }

  return (
    <>
      <section className="card mm">
        <div className="mm-top">
          <button type="button" className="mm-acct" onClick={copyAddr} title="Copy your Tron address">
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
              <span className="mm-fiat">{trx(account.balanceSun)}</span>
              <span className="mm-sub">
                {network === "mainnet" ? "TRON" : "TRON Nile testnet"}
                {usdt && usdt.balance != null ? `, ${formatUnits(BigInt(usdt.balance), 6)} USDT` : ""}
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
                {last.ambiguous
                  ? `${last.message || "The network did not confirm whether it accepted your send."} Check before sending again so you do not pay twice.`
                  : !last.settled
                    ? "Your transfer was sent and is waiting to confirm."
                    : last.unknown
                      ? "Your transfer was sent but its outcome could not be read. Check it on the explorer."
                      : last.success
                        ? "Your transfer confirmed."
                        : `Your transfer failed on chain (${last.result}). Any fee it used was still burned.`}
              </span>
              {last.txid && (
                <a className="tx-hash-link" href={`${explorer.tx}${last.txid}`} target="_blank" rel="noopener noreferrer">
                  {last.txid.slice(0, 12)}… <ExternalLink size={12} />
                </a>
              )}
            </span>
          </div>
        )}

        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "balance"} className="tab" onClick={() => setTab("balance")}>Holdings</button>
          <button type="button" role="tab" aria-selected={tab === "activity"} className="tab" onClick={() => setTab("activity")}>Activity</button>
        </div>

        {tab === "balance" ? (
          <div className="mm-list">
            {holdings.map((h) => (
              <div className="mm-row" key={h.symbol}>
                <TokenLogo symbol={h.symbol} native={h.symbol === "TRX"} />
                <span className="mm-row-main">
                  <span className="mm-row-name">{h.name}</span>
                  <span className="mm-row-note">{h.symbol === "TRX" ? "Pays every fee on TRON" : "TRC-20 token"}</span>
                </span>
                <span className="mm-row-right">
                  <span className="mm-row-fiat">{h.amount}</span>
                </span>
              </div>
            ))}
            {usdt && usdt.error && <p className="muted small" style={{ margin: 0 }}>USDT could not be read: {usdt.error}</p>}
          </div>
        ) : (
          <div className="mm-list">
            {historyError && <p className="muted small" style={{ margin: 0 }}>{historyError}</p>}
            {history === null && !historyError ? (
              <SkeletonLines count={3} />
            ) : (history || []).length === 0 ? (
              !historyError && <p className="muted small" style={{ margin: 0 }}>Nothing here yet.</p>
            ) : (
              history.map((t) => (
                <div className="mm-row" key={`${t.txid}-${t.symbol}`}>
                  <span className="mm-row-main">
                    <a className="mm-row-name num linklike" style={{ fontSize: 12.5 }} href={`${explorer.tx}${t.txid}`} target="_blank" rel="noopener noreferrer">
                      {String(t.txid).slice(0, 12)}...
                    </a>
                    <span className="mm-row-note">
                      {t.direction === "in" ? "Received" : "Sent"}
                      {t.success ? "" : ", failed"}
                      {t.at ? `, ${new Date(t.at).toLocaleString()}` : ""}
                    </span>
                  </span>
                  <span className="mm-row-right">
                    <span className="mm-row-fiat num">{formatUnits(BigInt(t.amount || 0), t.decimals)} {t.symbol}</span>
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {panel === "receive" && (
        <DetailPane view="receive" crumb="Receive on TRON" label="Receive on TRON" onBack={() => setPanel(null)}>
          <PageHeader title="Receive TRX or USDT" />
          <section className="card stack-sm">
            <p className="muted small" style={{ marginTop: 0 }}>
              Send only TRX or TRC-20 tokens to this address, on the TRON{network === "mainnet" ? "" : " Nile test"} network. USDT sent
              on another network, such as Ethereum, will not arrive here.
            </p>
            <code className="reveal-key" style={{ wordBreak: "break-all" }}>{address}</code>
            <div className="row wrap">
              <Button onClick={copyAddr}>{copied ? <Check size={14} /> : <Copy size={14} />} Copy address</Button>
              <a className="btn" href={`${explorer.address}${address}`} target="_blank" rel="noopener noreferrer">
                View on explorer <ExternalLink size={14} />
              </a>
            </div>
          </section>
        </DetailPane>
      )}

      {panel === "send" && (
        <DetailPane view="send" crumb="Send on TRON" label="Send on TRON" onBack={() => setPanel(null)}>
          <PageHeader title="Send on TRON" />
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
                    <option value="TRX">TRX</option>
                    <option value="USDT">USDT (TRC-20)</option>
                  </Select>
                </Field>
                <Field label="To address" error={to.trim() && !isTronAddress(to) ? "That is not a valid Tron address." : undefined}>
                  <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="T..." autoComplete="off" spellCheck={false} />
                </Field>
                <Field label={`Amount in ${asset}`}>
                  <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoComplete="off" />
                </Field>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <Button variant="primary" type="submit" loading={busy}>Review</Button>
                </div>
              </form>
            ) : (
              <form onSubmit={send} className="stack-sm">
                <dl className="trade-quote">
                  <div>
                    <dt>Sending</dt>
                    <dd className="num">{formatUnits(plan.units, 6)} {plan.asset}</dd>
                  </div>
                  <div>
                    <dt>To</dt>
                    <dd className="num sweep-dest">{plan.to}</dd>
                  </div>
                  <div>
                    <dt>{plan.asset === "TRX" ? "Network fee" : "Network fee, at most"}</dt>
                    <dd className="num">
                      {trx(plan.fee)}
                      <span className="quote-sub">
                        {plan.asset === "TRX"
                          ? plan.newAccount
                            ? `includes ${trx(plan.activation)} to activate an account that has never been used`
                            : "free when this account still has its daily bandwidth"
                          : `burned for about ${plan.energy.toLocaleString()} energy; unused energy is not charged`}
                      </span>
                    </dd>
                  </div>
                </dl>
                <Field label="Wallet password">
                  <Input type="password" value={sendPassword} onChange={(e) => setSendPassword(e.target.value)} autoComplete="current-password" />
                </Field>
                <p className="settings-note">
                  <ShieldCheck size={15} />
                  Built and signed here on your device, so the recipient and amount above are exactly what is sent.
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
