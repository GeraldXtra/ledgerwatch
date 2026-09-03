import { useState } from "react";
import { ethers } from "ethers";
import { Network, ShieldCheck } from "lucide-react";
import { Button, Field, Input, Select, useToast } from "../../components/ui";
import { getProvider, ERC20_ABI } from "./provider";
import { unlockWallet } from "./keystore";
import { recordTx, updateTxStatus } from "./walletApi";
import { NATIVE_TRANSFER_GAS, preflightGas } from "./gas";
import GasNotice from "./GasNotice";
import NetworkScopeNotice from "./NetworkScopeNotice";

/**
 * Send flow with a hard human-in-the-loop gate:
 *   form → estimate gas → REVIEW summary → password → sign LOCALLY → broadcast.
 * The key is decrypted only for the signing call and is discarded immediately. The
 * agent can pre-fill this form but never signs — only the user's password does.
 */
export default function SendForm({ address, chain, onSent, onConfirmed }) {
  const toast = useToast();
  const [step, setStep] = useState("form"); // form → review
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState("native"); // "native" | token address
  const [estimate, setEstimate] = useState(null); // { gasLimit, feeEth }
  const [gasPlan, setGasPlan] = useState(null); // preflightGas result
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const tokens = chain.tokens || [];
  const selectedToken = asset === "native" ? null : tokens.find((t) => t.address === asset);
  const symbol = selectedToken ? selectedToken.symbol : chain.nativeSymbol;
  const decimals = selectedToken ? selectedToken.decimals : chain.decimals;

  /**
   * Sending to your own address is ALWAYS a no-op that costs a fee — the funds
   * leave and come straight back on the same network. It is also the exact
   * signature of someone trying to move assets to another chain, because the
   * address is identical everywhere so it looks like the natural way to do it.
   *
   * This is caught BEFORE gas estimation, so the mistake costs nothing at all.
   */
  const isSelfSend = Boolean(
    to && address && ethers.isAddress(to) && to.toLowerCase() === address.toLowerCase()
  );

  /**
   * A recipient that is a CONTRACT THIS APP KNOWS is never a person. Sending
   * tokens to a token's own contract, or to the exchange router, is one of the
   * commonest ways money is destroyed: the transfer succeeds, the balance
   * leaves, and no key on earth can move it again. The registry lists exactly
   * these addresses, so the mistake can be refused before it costs a fee.
   */
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
    // Blocked outright rather than warned-and-allowed: there is no legitimate
    // reason to pay a fee to send funds to yourself on the same chain, so a
    // "proceed anyway" option would only ever help someone make the mistake.
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
      const provider = getProvider(chain.chainId);

      // Build the exact transaction, then ask whether it can be paid for BEFORE
      // showing the confirm step. Previously the fee was estimated and displayed
      // but never checked against the balance, so a zero-gas wallet only found
      // out at signing time, after typing a password.
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
        // A native send has to cover the amount AND the fee out of one balance.
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
      // Decrypt on demand; the plaintext key lives only for this signing call.
      const unlocked = await unlockWallet(password);
      const signer = unlocked.connect(provider);

      const value = ethers.parseUnits(String(amount), decimals);
      let txResp;
      if (selectedToken) {
        const contract = new ethers.Contract(selectedToken.address, ERC20_ABI, signer);
        txResp = await contract.transfer(to, value);
      } else {
        txResp = await signer.sendTransaction({ to, value });
      }

      // Record PUBLIC data only.
      const recorded = await recordTx({
        chainId: chain.chainId,
        hash: txResp.hash,
        from: address,
        to,
        value: String(amount),
        symbol,
        tokenAddress: selectedToken ? selectedToken.address : null,
        direction: "out",
      }).catch(() => null);

      // Settle the status in the background — a testnet confirmation takes 10-30s and
      // must never block the UI. WalletPage also reconciles stragglers on load, so a
      // tx that confirms after a reload still resolves.
      if (recorded && recorded._id) {
        txResp
          .wait()
          .then((receipt) =>
            updateTxStatus(recorded._id, receipt && receipt.status === 1 ? "confirmed" : "failed")
          )
          .then(() => onConfirmed && onConfirmed())
          .catch(() => {});
      }

      // NAMES THE CHAIN. "Sent 80 USDC" alone is what let a same-chain transfer
      // read as a completed cross-chain move; the network is the one fact that
      // makes the outcome unambiguous.
      toast(`Sent ${amount} ${symbol} on ${chain.name}. Track it in history.`, { type: "success" });
      onSent(txResp);
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

  /**
   * The blocked self-send. Deliberately explains rather than just refusing —
   * someone who lands here is almost certainly trying to bridge, and "invalid
   * recipient" would teach them nothing and leave them to try again.
   */
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

        {/* The network leads the summary and is emphasised: it is the field
            most likely to be assumed rather than read, and the only one whose
            misreading cannot be undone after signing. */}
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

        {/* The password field is withheld entirely when the fee cannot be paid.
            Offering it would invite the user to type a password for a
            transaction that is guaranteed to fail. */}
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
            {busy ? "Signing…" : !gasPlan || gasPlan.ok ? "Sign & send" : `Not enough ${chain.nativeSymbol}`}
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

      {/* Caught at typing time as well as at submit, so the explanation arrives
          before the user commits to the idea rather than after. */}
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
              <option key={t.address} value={t.address}>{t.symbol}</option>
            ))}
          </Select>
        </Field>
      </div>

      <NetworkScopeNotice chain={chain} />

      <div className="wallet-guarantee subtle">
        <ShieldCheck size={15} />
        <span>The next step shows a full summary and asks for your password before anything is signed.</span>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? "Estimating…" : "Review transaction"}
        </Button>
      </div>
    </form>
  );
}
