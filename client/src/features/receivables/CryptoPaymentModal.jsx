import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Coins,
  ExternalLink,
  KeyRound,
  ShieldCheck,
  TriangleAlert,
  Wallet,
  X,
} from "lucide-react";
import { Button, Field, Input, Modal, Select, SkeletonLines } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { hasWallet, unlockWallet } from "../wallet/keystore";
import { canDerive, deriveAddressFromWallet } from "../wallet/derivation";
import { allocateIndex, createPaymentAddress, fetchChains, fetchQuote } from "./cryptoApi";
import { agoLabel, ngn, usdc } from "./format";

/**
 * Issue a stablecoin payment address for one invoice.
 *
 * ORDER MATTERS: the password is validated BEFORE an index is allocated.
 * Allocating permanently consumes a derivation index — the counter only ever
 * moves forward and an index is never reused — so allocating first would burn
 * one on every mistyped password. The gap would be harmless but pointless.
 *
 * The address is derived HERE, in the browser, from the decrypted keystore. Only
 * the public address and its index are ever sent to the server.
 */
export default function CryptoPaymentModal({ debt, onClose, onCreated }) {
  const { user } = useAuth();
  const [chains, setChains] = useState(null); // null = still loading
  const [chainId, setChainId] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [cannotDerive, setCannotDerive] = useState(false);

  // Checked synchronously: whether a keystore exists at all. Whether it can
  // DERIVE cannot be known until it is decrypted, so that check happens on
  // submit — see `cannotDerive`.
  const walletPresent = hasWallet();

  useEffect(() => {
    let active = true;
    fetchChains()
      .then((list) => {
        if (!active) return;
        // Only chains with a configured stablecoin can accept an invoice payment.
        const usable = list.filter((c) => (c.tokens || []).length > 0);
        setChains(usable);
        // The account's chosen default from Settings, then Base Sepolia (the app
        // default and cheapest to test on), then whatever is enabled. Hardcoding
        // a chain here would quietly ignore the preference the user just set.
        const preferredId = user?.crypto?.defaultChainId || 84532;
        const preferred =
          usable.find((c) => c.chainId === preferredId) ||
          usable.find((c) => c.chainId === 84532) ||
          usable[0];
        if (preferred) setChainId(preferred.chainId);
      })
      .catch(() => setChains([]));
    return () => {
      active = false;
    };
  }, [user?.crypto?.defaultChainId]);

  // Re-quote whenever the chain changes. This reserves nothing, so switching
  // networks to compare is free.
  useEffect(() => {
    if (!chainId || !walletPresent) return;
    let active = true;
    setQuote(null);
    setQuoteError("");
    fetchQuote({ debtId: debt._id, chainId })
      .then((q) => {
        if (active) setQuote(q);
      })
      .catch((err) => {
        if (active) setQuoteError(err?.response?.data?.error || "Could not price this invoice.");
      });
    return () => {
      active = false;
    };
  }, [chainId, debt._id, walletPresent]);

  const chain = useMemo(
    () => (chains || []).find((c) => c.chainId === chainId) || null,
    [chains, chainId]
  );

  async function issue(e) {
    e.preventDefault();
    setError("");
    if (!chain) return setError("Choose a network first.");
    if (!password) return setError("Enter your wallet password.");

    // 1. Prove the password works AND that this wallet can derive at all, before
    //    anything irreversible happens. One unlock, reused below: scrypt is
    //    deliberately slow, so unlocking twice would double the wait.
    //
    //    The unlock gets its OWN try/catch so "that password did not work" is
    //    said only when the unlock is what failed. Pattern matching over every
    //    error in one block risks blaming the password for an unrelated failure,
    //    which is the worst mistake this particular screen could make.
    let master;
    try {
      // The progress callback matters here: scrypt runs for seconds, and a button
      // that just says "working" for that long reads as a hang.
      setBusy("Unlocking your wallet");
      master = await unlockWallet(password, (pct) => {
        const done = Math.round((Number(pct) || 0) * 100);
        if (done < 100) setBusy(`Unlocking your wallet ${done}%`);
      });
    } catch (err) {
      const msg = (err && err.message) || "";
      setBusy("");
      setError(
        /no wallet on this device/i.test(msg)
          ? "There is no wallet saved for this account in this browser. Create one on the Wallet page first."
          : "That password did not unlock this account's wallet. Each account has its own wallet and its own password."
      );
      return;
    }

    if (!canDerive(master)) {
      setCannotDerive(true);
      setBusy("");
      return;
    }

    try {
      // 2. Reserve an index atomically. From here on the index is spent.
      setBusy("Reserving an address");
      const alloc = await allocateIndex(chain.chainId);

      // 3. Derive in the browser. The key exists only inside this call.
      const address = deriveAddressFromWallet(master, alloc.derivationIndex);

      // 4. Send the PUBLIC address up to be recorded against the invoice.
      setBusy("Saving the address");
      const saved = await createPaymentAddress({
        debtId: debt._id,
        chainId: chain.chainId,
        address,
        derivationIndex: alloc.derivationIndex,
      });

      setPassword("");
      onCreated(saved);
    } catch (err) {
      // The wallet is already open by this point, so nothing here is ever a
      // password problem. Report what actually went wrong.
      const msg = err?.response?.data?.error || err.message || "";
      setError(msg || "Could not create the payment address.");
      setBusy("");
    }
  }

  // ---- No wallet at all ----
  if (!walletPresent) {
    return (
      <Modal label="Crypto payment" onClose={onClose}>
        <Head onClose={onClose} title="Crypto payment" />
        <div className="crypto-blocked">
          <span className="icon-tile neutral">
            <Wallet size={16} />
          </span>
          <div>
            <div className="card-title">You need a wallet first</div>
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              Payment addresses are derived from your own wallet, so money arrives somewhere
              only you control. Create or import one, then come back to this invoice.
            </p>
          </div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Link to="/app/wallet" className="btn btn-primary" onClick={onClose}>
            Go to Wallet <ExternalLink size={14} />
          </Link>
        </div>
      </Modal>
    );
  }

  // ---- Wallet present but mathematically unable to derive ----
  if (cannotDerive) {
    return (
      <Modal label="Crypto payment" onClose={onClose}>
        <Head onClose={onClose} title="Crypto payment" />
        <div className="crypto-blocked">
          <span className="icon-tile neutral">
            <KeyRound size={16} />
          </span>
          <div>
            <div className="card-title">This wallet cannot create payment addresses</div>
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              It was imported from a private key on its own. A private key carries no recovery
              phrase and no chain code, so there is no way to derive further addresses from it.
              That is a property of the key itself, not a limit we have set.
            </p>
            <p className="muted small" style={{ margin: "8px 0 0" }}>
              Import the same wallet again using its 12 word recovery phrase and this becomes
              available. Your existing balance and address do not change.
            </p>
          </div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Link to="/app/wallet" className="btn btn-primary" onClick={onClose}>
            Go to Wallet <ExternalLink size={14} />
          </Link>
        </div>
      </Modal>
    );
  }

  const noChains = chains && chains.length === 0;
  const nothingOwed = quote && quote.balanceNgn <= 0;
  const alreadyActive = quote && quote.hasActiveAddress;
  const blocked = Boolean(noChains || nothingOwed || alreadyActive || quoteError);

  return (
    <Modal label="Crypto payment" onClose={onClose}>
      <Head onClose={onClose} title={`Crypto payment for ${debt.debtorName}`} />

      <div className="row wrap">
        {/* The network badge that stood here is gone at the owner's request.
            The chain is named in the quote itself and in the payer's message. */}
        {quote && quote.rateStale && (
          <span className="pill warn">Rate is a fallback, not live</span>
        )}
      </div>

      <p className="muted small" style={{ margin: 0 }}>
        This invoice gets an address of its own, so anything arriving at it is matched to this
        debt automatically. The address is derived from your wallet inside this browser and only
        the public address is stored.
      </p>

      <form className="stack" onSubmit={issue}>
        <Field label="Network">
          <Select
            value={chainId || ""}
            onChange={(e) => setChainId(Number(e.target.value))}
            disabled={Boolean(busy) || !chains || chains.length === 0}
          >
            {(chains || []).map((c) => (
              <option key={c.chainId} value={c.chainId}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        {noChains && (
          <p className="error-text" style={{ margin: 0 }}>
            No network with a configured stablecoin is enabled, so an address cannot be issued.
          </p>
        )}

        {quoteError && (
          <p className="error-text" style={{ margin: 0 }}>
            {quoteError}
          </p>
        )}

        {!quote && !quoteError && !noChains ? (
          <SkeletonLines count={3} />
        ) : quote ? (
          <>
            <dl className="trade-quote">
              <div>
                <dt>Invoice balance</dt>
                <dd className="num">{ngn(quote.balanceNgn)}</dd>
              </div>
              <div>
                <dt>Amount to request</dt>
                <dd className="num">{usdc(quote.expectedUsdc, quote.token && quote.token.symbol)}</dd>
              </div>
              <div>
                <dt>Rate used</dt>
                <dd className="num">
                  {ngn(quote.ngnPerUsd)} per USDC
                  <span className="quote-sub">{agoLabel(quote.rateTimestamp)}</span>
                </dd>
              </div>
              <div>
                <dt>Token accepted</dt>
                <dd>
                  {quote.token.symbol} on {chain ? chain.name : "this network"}
                </dd>
              </div>
              <div>
                <dt>Expires in</dt>
                <dd className="num">
                  {quote.expiryHours} hours
                  <span className="quote-sub">
                    settles after {quote.confirmations} confirmations
                  </span>
                </dd>
              </div>
            </dl>

            <p className="muted small" style={{ margin: 0 }}>
              The USDC figure is rounded up to the cent, so a payer who sends exactly this
              amount always clears the invoice in full. It is locked to the rate above when you
              create the address, so a later move in the rate cannot leave this debtor still
              owing money.
            </p>
          </>
        ) : null}

        {nothingOwed && (
          <p className="error-text" style={{ margin: 0 }}>
            This invoice has nothing outstanding, so there is nothing to collect.
          </p>
        )}

        {alreadyActive && (
          <p className="error-text" style={{ margin: 0 }}>
            This invoice already has an active payment address. Close this and use the crypto
            payment section below the figures, or revoke the existing address first.
          </p>
        )}

        <Field label="Wallet password">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="Unlocks your wallet to derive the address"
            disabled={Boolean(busy) || blocked}
          />
        </Field>

        <p className="settings-note">
          <ShieldCheck size={15} />
          Your password decrypts the keystore in this browser and is then discarded. Neither it
          nor any key is ever sent to the server.
        </p>

        {error && (
          <div className="against-note">
            <TriangleAlert size={15} />
            <span>{error}</span>
          </div>
        )}

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose} disabled={Boolean(busy)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={Boolean(busy) || blocked || !chain}>
            {busy ? `${busy}…` : "Create payment address"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Head({ title, onClose }) {
  return (
    <div className="row space-between">
      <h3 className="section-title row">
        <Coins size={17} /> {title}
      </h3>
      <Button variant="ghost" icon title="Close" onClick={onClose}>
        <X size={15} />
      </Button>
    </div>
  );
}
