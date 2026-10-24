import { useState } from "react";
import { ethers } from "ethers";
import { Network, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button, Field, Input, Select, useToast } from "../../components/ui";
import { getProvider, ERC20_ABI } from "./provider";
import { unlockWallet } from "./keystore";
import { fetchTxs, updateTxStatus } from "./walletApi";
import { sendRecorded, trackConfirmation } from "./broadcast";
import { NATIVE_TRANSFER_GAS, preflightGas } from "./gas";
import { counterpartiesFrom, lookalikeOf } from "./addressSafety";
import GasNotice from "./GasNotice";
import NetworkScopeNotice from "./NetworkScopeNotice";

const SEND_TRACKING_MS = 30 * 60 * 1000;

export default function SendForm({ address, chain, tokens: tokenList, onSent, onConfirmed }) {
  const toast = useToast();
  const [step, setStep] = useState("form");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState("native");
  const [estimate, setEstimate] = useState(null);
  const [gasPlan, setGasPlan] = useState(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lookalike, setLookalike] = useState(null);
  const [lookalikeChecked, setLookalikeChecked] = useState(false);
  const [historyUnread, setHistoryUnread] = useState(false);

  const tokens = tokenList || chain.tokens || [];
  const selectedToken = asset === "native" ? null : tokens.find((t) => t.address === asset);
  const symbol = selectedToken ? selectedToken.symbol : chain.nativeSymbol;
  const decimals = selectedToken ? selectedToken.decimals : chain.decimals;

  const isSelfSend = Boolean(
    to && address && ethers.isAddress(to) && to.toLowerCase() === address.toLowerCase()
  );

  const knownContract = (() => {
    if (!to || !ethers.isAddress(to)) return null;
    const lower = to.toLowerCase();
    const token = tokens.find((t) => String(t.address).toLowerCase() === lower);
    if (token) return `the ${token.symbol} token contract`;
    const dex = chain.dex || {};
    if (dex.router && String(dex.router).toLowerCase() === lower) return "the exchange router";
    if (dex.quoter && String(dex.quoter).toLowerCase() === lower) return "the exchange quoter";
    return null;
  })();

  async function review(e) {
    e.preventDefault();
    setError("");
    if (!ethers.isAddress(to)) return setError("Enter a valid recipient address.");
    if (isSelfSend) return setStep("self");
    if (knownContract) {
      return setError(
        `That address is ${knownContract} on ${chain.name}, not a wallet. Anything sent there cannot be recovered by anyone.`
      );
    }
    let value;
    try {
      value = ethers.parseUnits(String(amount), decimals);
    } catch {
      return setError("Enter a valid amount.");
    }
    if (value <= 0n) return setError("Amount must be greater than zero.");

    setBusy(true);
    try {
      let similar = null;
      try {
        similar = lookalikeOf(to, counterpartiesFrom(await fetchTxs(chain.chainId), address));
        setHistoryUnread(false);
      } catch {
        setHistoryUnread(true);
      }
      if (similar && (!lookalike || lookalike.to !== to.toLowerCase() || !lookalikeChecked)) {
        if (!lookalike || lookalike.to !== to.toLowerCase()) setLookalikeChecked(false);
        setLookalike({ to: to.toLowerCase(), similar });
        return;
      }
      if (!similar) setLookalike(null);

      const provider = getProvider(chain.chainId);

      const tx = selectedToken
        ? {
            to: selectedToken.address,
            data: new ethers.Interface(ERC20_ABI).encodeFunctionData("transfer", [to, value]),
          }
        : { to, value };

      const plan = await preflightGas({
        provider,
        from: address,
        tx,
        valueWei: selectedToken ? 0n : value,
        fallbackGas: selectedToken ? undefined : NATIVE_TRANSFER_GAS,
      });

      setGasPlan(plan);
      setEstimate({
        gasLimit: plan.gasLimit.toString(),
        feeEth: ethers.formatEther(plan.feeWei),
      });
      setStep("review");
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmSend(e) {
    e.preventDefault();
    setError("");
    if (!password) return setError("Enter your wallet password to sign.");
    setBusy(true);
    try {
      const provider = getProvider(chain.chainId);
      const unlocked = await unlockWallet(password);
      const signer = unlocked.connect(provider);

      const value = ethers.parseUnits(String(amount), decimals);
      const request = selectedToken
        ? {
            to: selectedToken.address,
            data: new ethers.Interface(ERC20_ABI).encodeFunctionData("transfer", [to, value]),
          }
        : { to, value };
      const { hash, row: recorded, sent } = await sendRecorded({
        signer,
        provider,
        request,
        record: {
          chainId: chain.chainId,
          from: address,
          to,
          value: String(amount),
          symbol,
          tokenAddress: selectedToken ? selectedToken.address : null,
          direction: "out",
        },
        label: "transfer",
      });

      trackConfirmation({
        provider,
        hash,
        response: sent.response,
        timeoutMs: SEND_TRACKING_MS,
        onSettled: (status) =>
          updateTxStatus(recorded._id, status).then(() => onConfirmed && onConfirmed()),
      });

      if (sent.outcome === "accepted") {
        toast(`Sent ${amount} ${symbol} on ${chain.name}. Track it in history.`, { type: "success" });
      } else {
        toast(
          `This transfer was signed and sent, but the network did not confirm that it received it ` +
            `(${sent.reason}). It is saved in your history as pending. Check ${hash.slice(0, 10)}… on ` +
            `the explorer before you send again, so it is not sent twice.`,
          { type: "error", duration: 16000 }
        );
      }
      onSent();
    } catch (err) {
      setError(friendly(err));
      setBusy(false);
    }
  }

  function friendly(err) {
    const msg = (err && (err.shortMessage || err.reason || err.message)) || "Transaction failed";
    if (/incorrect password|invalid password|could not decrypt/i.test(msg)) {
      return "Incorrect password.";
    }
    if (/insufficient funds/i.test(msg)) return "Insufficient funds for amount + gas.";
    return msg;
  }

  if (step === "self") {
    return (
      <div className="stack">
        <div>
          <h3 className="section-title">This would not move your funds</h3>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            That is your own address, on {chain.name}.
          </p>
        </div>

        <div className="self-send-block">
          <p>
            Sending {amount || "funds"} {symbol} to yourself on {chain.name} would succeed, appear
            in your history as a completed transfer, and leave your balance exactly where it
            started, minus the network fee. Nothing would arrive on any other network.
          </p>
        </div>

        <NetworkScopeNotice chain={chain} tone="warning" />

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => { setStep("form"); setTo(""); }}>
            Change recipient
          </Button>
          {chain.bridge && (
            <a
              className="btn btn-primary"
              href={chain.bridge.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open {chain.bridge.name}
            </a>
          )}
        </div>
      </div>
    );
  }

  if (step === "review") {
    return (
      <form className="stack" onSubmit={confirmSend}>
        <div>
          <h3 className="section-title">Review &amp; confirm</h3>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            You approve every transaction. Nothing is signed until you enter your password.
          </p>
        </div>

        <div className="review-chain-banner">
          <Network size={15} />
          <span>
            Sending on <strong>{chain.name}</strong>, and the funds stay on this network
          </span>
        </div>

        <dl className="tx-summary">
          <div><dt>Network</dt><dd><strong>{chain.name}</strong></dd></div>
          <div><dt>Asset</dt><dd>{symbol}</dd></div>
          <div><dt>To</dt><dd className="num">{to}</dd></div>
          <div><dt>Amount</dt><dd className="num">{amount} {symbol}</dd></div>
          <div><dt>Est. network fee</dt><dd className="num">≈ {Number(estimate.feeEth).toFixed(6)} {chain.nativeSymbol}</dd></div>
        </dl>

        <GasNotice plan={gasPlan} chain={chain} />

        {gasPlan && gasPlan.ok && (
          <Field label="Wallet password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
            />
          </Field>
        )}

        {error && <p className="error-text">{error}</p>}

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => { setStep("form"); setPassword(""); }} disabled={busy}>
            Back
          </Button>
          <Button variant="primary" type="submit" disabled={busy || !gasPlan || !gasPlan.ok}>
            {busy
              ? "Signing…"
              : !gasPlan || gasPlan.ok
                ? "Sign & send"
                : gasPlan.reverted
                  ? "This would fail"
                  : `Not enough ${chain.nativeSymbol}`}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form className="stack" onSubmit={review}>
      <div>
        <h3 className="section-title row">
          Send
          <span className="chain-chip">
            <Network size={12} /> {chain.name}
          </span>
        </h3>
        <p className="muted small" style={{ margin: "4px 0 0" }}>
          This transfer stays on {chain.name}.
        </p>
      </div>

      <Field label="Recipient address">
        <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" required />
      </Field>

      {isSelfSend && (
        <p className="inline-warn">
          That is your own address. Sending to yourself stays on {chain.name} and moves nothing
          between networks.
        </p>
      )}
      <div className="grid2">
        <Field label="Amount">
          <Input
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Field>
        <Field label="Asset">
          <Select value={asset} onChange={(e) => setAsset(e.target.value)}>
            <option value="native">{chain.nativeSymbol} (native)</option>
            {tokens.map((t) => (
              <option key={t.address} value={t.address}>
                {t.symbol}
                {t.custom ? " (added by you)" : ""}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <NetworkScopeNotice chain={chain} />

      <div className="wallet-guarantee subtle">
        <ShieldCheck size={15} />
        <span>The next step shows a full summary and asks for your password before anything is signed.</span>
      </div>

      {lookalike && to && lookalike.to === to.toLowerCase() && (
        <div className="against-note">
          <TriangleAlert size={15} />
          <span className="stack-sm">
            <span>
              This address looks like <code>{lookalike.similar}</code> from your history, but it is a
              different address. Scammers send tiny amounts from lookalike addresses so that you copy
              theirs by mistake. Check every character against the address you mean to pay.
            </span>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={lookalikeChecked}
                onChange={(e) => setLookalikeChecked(e.target.checked)}
              />
              <span>I have checked every character, and this is the address I mean to pay.</span>
            </label>
          </span>
        </div>
      )}

      {historyUnread && (
        <p className="muted small" style={{ margin: 0 }}>
          Your history could not be read, so this address was not compared with the ones you have used before.
        </p>
      )}

      {error && <p className="error-text">{error}</p>}

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? "Estimating…" : "Review transaction"}
        </Button>
      </div>
    </form>
  );
}
