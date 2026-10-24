import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "ethers";
import { ArrowDownToLine, ArrowUpRight, Check, Copy, ExternalLink, KeyRound, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import http from "../../api/http";
import { Button, Field, Input, PageHeader, Select, SkeletonLines } from "../../components/ui";
import { DetailPane } from "../../components/ui/Modal";
import TokenLogo from "../../components/TokenLogo";
import { unlockWallet } from "./keystore";
import { cacheChainAddress, ensureChainAddressRegistered, readChainAddress } from "./chainAddresses";
import { buildSolTransfer, buildTokenTransfer, deriveSolanaAccount, isSolanaAddress } from "./solana/solana";

const BASE_FEE = 5000n;
const TRANSFER_UNITS = 6000n;

function reason(err) {
  return err?.response?.data?.error || err?.message || "the network did not answer";
}

function sol(lamports) {
  return `${formatUnits(BigInt(lamports || 0), 9)} SOL`;
}

function explorerFor(network, kind, id) {
  const cluster = network === "mainnet" ? "" : "?cluster=devnet";
  return `https://explorer.solana.com/${kind}/${id}${cluster}`;
}

export default function SolanaPanel({ userId, network, evmAddress = null }) {
  const [address, setAddress] = useState(() => readChainAddress(userId, "solana", network, evmAddress));
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

  const [asset, setAsset] = useState("SOL");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [sendPassword, setSendPassword] = useState("");
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState("");
  const [last, setLast] = useState(null);

  useEffect(() => {
    setAddress(readChainAddress(userId, "solana", network, evmAddress));
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
      const { data } = await http.get("/api/solana/account", { params: { address, network } });
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
      const { data } = await http.get("/api/solana/history", { params: { address, network } });
      setHistory(data.items || []);
      setHistoryError(null);
    } catch (err) {
      setHistoryError(reason(err));
    }
  }, [address, network]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (address) ensureChainAddressRegistered("solana", network, address);
  }, [address, network]);

  useEffect(() => {
    if (tab === "activity" && history === null && address) loadHistory();
  }, [tab, history, address, loadHistory]);

  useEffect(() => {
    if (!last || last.settled || !last.signature) return undefined;
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      try {
        const { data } = await http.get("/api/solana/status", { params: { signature: last.signature, network } });
        if (data.found && data.confirmation && data.confirmation !== "processed") {
          setLast((l) => ({ ...l, settled: true, success: data.success, error: data.error }));
          load();
          setHistory(null);
        }
      } catch {
        if (tries > 30) setLast((l) => ({ ...l, settled: true, unknown: true }));
      }
      if (tries > 30) {
        clearInterval(timer);
        setLast((l) => (l && !l.settled ? { ...l, settled: true, unknown: true } : l));
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [last, network, load]);

  const tokens = useMemo(() => (account && account.tokens) || [], [account]);
  const selectedToken = asset === "SOL" ? null : tokens.find((t) => t.symbol === asset) || null;

  async function setUp(e) {
    e.preventDefault();
    setError("");
    setUnlocking(true);
    try {
      const wallet = await unlockWallet(password);
      const phrase = wallet?.mnemonic?.phrase;
      if (!phrase) throw new Error("This wallet was imported from a bare private key, so it has no recovery phrase and no Solana account can be derived from it.");
      const acct = deriveSolanaAccount(phrase);
      cacheChainAddress(userId, "solana", network, acct.address, evmAddress || wallet.address);
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
    const dest = to.trim();
    if (!isSolanaAddress(dest)) return setSendError("That is not a Solana address.");
    if (dest === address) return setSendError("That is this wallet's own address.");
    let units;
    try {
      units = parseUnits(String(amount).trim(), selectedToken ? selectedToken.decimals : 9);
    } catch {
      return setSendError(`Enter an amount with at most ${selectedToken ? selectedToken.decimals : 9} decimal places.`);
    }
    if (units <= 0n) return setSendError("The amount must be more than zero.");
    if (!account) return setSendError("Your balance has not loaded yet.");
    const lamports = BigInt(account.lamports || 0);

    setBusy(true);
    try {
      const [{ data: r }, { data: p }] = await Promise.all([
        http.get("/api/solana/recipient", { params: { address: dest, network, ...(selectedToken ? { mint: selectedToken.mint } : {}) } }),
        http.get("/api/solana/priority", { params: { network } }),
      ]);
      if (r.isProgram) return setSendError("That address is a program, not a wallet. Anything sent there cannot be recovered.");
      if (r.isTokenAccount) {
        return setSendError("That is a token account, not a wallet address. Ask the recipient for their Solana wallet address instead; tokens sent this way are usually lost.");
      }
      const micro = BigInt(Math.max(0, Number(p.microLamports || 0)));
      const priority = (micro * TRANSFER_UNITS + 999999n) / 1000000n;
      const fee = BASE_FEE + priority;

      if (!selectedToken) {
        if (!r.exists && units < BigInt(r.accountRent)) {
          return setSendError(`A Solana account that has never been used needs at least ${sol(r.accountRent)} to exist, so send at least that much.`);
        }
        const remaining = lamports - units - fee;
        if (remaining < 0n) return setSendError(`Sending ${sol(units)} needs ${sol(units + fee)} including the fee, and this account holds ${sol(lamports)}.`);
        const rent = BigInt(r.accountRent);
        if (remaining > 0n && remaining < rent) {
          return setSendError(`That would leave ${sol(remaining)}, below the ${sol(rent)} an account must keep. Send all of it, or leave at least ${sol(rent)}.`);
        }
        setPlan({ asset: "SOL", to: dest, units, fee, micro });
      } else {
        if (selectedToken.amount == null) return setSendError(`Your ${selectedToken.symbol} balance could not be read, so nothing can be sent yet.`);
        if (BigInt(selectedToken.amount) < units) return setSendError(`This account holds ${formatUnits(BigInt(selectedToken.amount), selectedToken.decimals)} ${selectedToken.symbol}.`);
        const rent = r.hasTokenAccount ? 0n : BigInt(r.tokenAccountRent);
        if (lamports < fee + rent) {
          return setSendError(
            `This transfer costs ${sol(fee + rent)} in SOL${rent ? `, including ${sol(rent)} to open the recipient's ${selectedToken.symbol} account` : ""}, and this account holds ${sol(lamports)}.`
          );
        }
        setPlan({ asset: selectedToken.symbol, token: selectedToken, to: dest, units, fee: fee + rent, rent, micro, createRecipientAccount: !r.hasTokenAccount });
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
      if (!phrase) throw new Error("This wallet has no recovery phrase, so it cannot sign for Solana.");
      const acct = deriveSolanaAccount(phrase);
      if (acct.address !== address) throw new Error("This wallet's Solana address is not the one shown here, so nothing was signed.");
      const { data: bh } = await http.get("/api/solana/blockhash", { params: { network } });
      const built = plan.token
        ? buildTokenTransfer({
            owner: address,
            to: plan.to,
            mint: plan.token.mint,
            decimals: plan.token.decimals,
            amount: plan.units,
            recentBlockhash: bh.blockhash,
            secret: acct.secret,
            createRecipientAccount: plan.createRecipientAccount,
            priorityMicroLamports: Number(plan.micro),
          })
        : buildSolTransfer({ from: address, to: plan.to, lamports: plan.units, recentBlockhash: bh.blockhash, secret: acct.secret, priorityMicroLamports: Number(plan.micro) });
      setLast({ signature: built.signature, asset: plan.asset, units: plan.units, to: plan.to, settled: false });
      const { data } = await http.post("/api/solana/send", { transaction: built.base64, network });
      if (data.signature !== built.signature) {
        setLast((l) => ({ ...l, signature: data.signature }));
      }
      setPlan(null);
      setTo("");
      setAmount("");
      setPanel(null);
      setTab("activity");
    } catch (err) {
      const refused = err?.response?.data?.kind === "rejected";
      if (refused) setLast(null);
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
        <h3 className="section-title" style={{ margin: "0 0 6px" }}>Unlock once to set up Solana</h3>
        <p className="muted small" style={{ margin: "0 0 14px", maxWidth: "46ch" }}>
          Your Solana account comes from the same recovery phrase as the rest of this wallet, on the path Phantom and Solflare use,
          so the same phrase shows it in those wallets too. Sending always asks for your password again.
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
          <Button variant="primary" type="submit" loading={unlocking} block>Set up Solana</Button>
        </form>
      </div>
    );
  }

  return (
    <>
      <section className="card mm">
        <div className="mm-top">
          <button type="button" className="mm-acct" onClick={copyAddr} title="Copy your Solana address">
            <span className="addr num" style={{ fontSize: 12 }}>{address.slice(0, 6)}...{address.slice(-6)}</span>
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
              <span className="mm-fiat">{sol(account.lamports)}</span>
              <span className="mm-sub">{network === "mainnet" ? "Solana" : "Solana devnet"}</span>
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
                  ? "Your transfer was sent and is waiting to confirm. Sending the same signed transfer again could never pay twice."
                  : last.unknown
                    ? "Your transfer was sent but did not confirm within a minute and a half. If it does not appear on the explorer it expired, and nothing was taken."
                    : last.success
                      ? "Your transfer confirmed."
                      : `Your transfer failed on chain (${last.error}). Only the network fee was spent.`}
              </span>
              <a className="tx-hash-link" href={explorerFor(network, "tx", last.signature)} target="_blank" rel="noopener noreferrer">
                {last.signature.slice(0, 12)}… <ExternalLink size={12} />
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
              <TokenLogo symbol="SOL" native />
              <span className="mm-row-main">
                <span className="mm-row-name">Solana</span>
                <span className="mm-row-note">Pays every fee on Solana</span>
              </span>
              <span className="mm-row-right">
                <span className="mm-row-fiat">{account ? sol(account.lamports) : "Unknown"}</span>
              </span>
            </div>
            {tokens.map((t) => (
              <div className="mm-row" key={t.mint}>
                <TokenLogo symbol={t.symbol} />
                <span className="mm-row-main">
                  <span className="mm-row-name">{t.name}</span>
                  <span className="mm-row-note">SPL token</span>
                </span>
                <span className="mm-row-right">
                  <span className="mm-row-fiat">{t.amount == null ? "Unknown" : `${formatUnits(BigInt(t.amount), t.decimals)} ${t.symbol}`}</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mm-list">
            {historyError ? (
              <p className="error-text small" style={{ margin: 0 }}>Activity could not be loaded: {historyError}.</p>
            ) : history === null ? (
              <SkeletonLines count={3} />
            ) : history.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>Nothing here yet.</p>
            ) : (
              history.map((t) => (
                <div className="mm-row" key={t.signature}>
                  <span className="mm-row-main">
                    <a className="mm-row-name num linklike" style={{ fontSize: 12.5 }} href={explorerFor(network, "tx", t.signature)} target="_blank" rel="noopener noreferrer">
                      {String(t.signature).slice(0, 12)}...
                    </a>
                    <span className="mm-row-note">
                      {t.success ? "Confirmed" : "Failed"}
                      {t.at ? `, ${new Date(t.at).toLocaleString()}` : ""}
                    </span>
                  </span>
                  <span className="mm-row-right">
                    {t.changes.length === 0 ? (
                      <span className="mm-row-fiat num muted">No balance change</span>
                    ) : (
                      t.changes.map((c) => (
                        <span key={c.symbol} className="mm-row-fiat num">
                          {BigInt(c.delta) > 0n ? "+" : ""}
                          {formatUnits(BigInt(c.delta), c.decimals)} {c.symbol}
                        </span>
                      ))
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {panel === "receive" && (
        <DetailPane view="receive" crumb="Receive on Solana" label="Receive on Solana" onBack={() => setPanel(null)}>
          <PageHeader title="Receive SOL, USDC or USDT" />
          <section className="card stack-sm">
            <p className="muted small" style={{ marginTop: 0 }}>
              Send only SOL or Solana tokens to this address, on Solana{network === "mainnet" ? "" : " devnet"}. USDC sent on another
              network, such as Base or Ethereum, will not arrive here.
            </p>
            <code className="reveal-key" style={{ wordBreak: "break-all" }}>{address}</code>
            <div className="row wrap">
              <Button onClick={copyAddr}>{copied ? <Check size={14} /> : <Copy size={14} />} Copy address</Button>
              <a className="btn" href={explorerFor(network, "address", address)} target="_blank" rel="noopener noreferrer">
                View on explorer <ExternalLink size={14} />
              </a>
            </div>
          </section>
        </DetailPane>
      )}

      {panel === "send" && (
        <DetailPane view="send" crumb="Send on Solana" label="Send on Solana" onBack={() => setPanel(null)}>
          <PageHeader title="Send on Solana" />
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
                    <option value="SOL">SOL</option>
                    {tokens.map((t) => (
                      <option key={t.mint} value={t.symbol}>{t.symbol}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="To address" error={to.trim() && !isSolanaAddress(to) ? "That is not a valid Solana address." : undefined}>
                  <Input value={to} onChange={(e) => setTo(e.target.value)} autoComplete="off" spellCheck={false} />
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
                    <dd className="num">{formatUnits(plan.units, plan.token ? plan.token.decimals : 9)} {plan.asset}</dd>
                  </div>
                  <div>
                    <dt>To</dt>
                    <dd className="num sweep-dest">{plan.to}</dd>
                  </div>
                  <div>
                    <dt>Network cost</dt>
                    <dd className="num">
                      {sol(plan.fee)}
                      <span className="quote-sub">
                        {plan.rent ? `includes ${sol(plan.rent)} to open the recipient's ${plan.asset} account, which they keep` : "the network fee"}
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
