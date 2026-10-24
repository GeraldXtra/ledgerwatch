import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ExternalLink,
  KeyRound,
  ShieldCheck,
  TriangleAlert,
  Wallet,
  X,
} from "lucide-react";
import { Button, Field, Input, Modal, PageHeader, Select, SkeletonLines } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { hasWallet, unlockWallet } from "../wallet/keystore";
import { canDerive, deriveAddressFromWallet } from "../wallet/derivation";
import {
  allocateIndex,
  createPaymentAddress,
  fetchChains,
  fetchQuote,
  revokePaymentAddress,
} from "./cryptoApi";
import { agoLabel, ngn, usdc } from "./format";

export default function CryptoPaymentModal({ debt, onClose, onCreated }) {
  const { user } = useAuth();
  const [chains, setChains] = useState(null);
  const [chainsError, setChainsError] = useState("");
  const [chainId, setChainId] = useState(null);
  const [tokenSymbol, setTokenSymbol] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [cannotDerive, setCannotDerive] = useState(false);

  const walletPresent = hasWallet();

  useEffect(() => {
    let active = true;
    fetchChains()
      .then((list) => {
        if (!active) return;
        const usable = list.filter((c) => (c.stables || []).length > 0);
        setChains(usable);
        const preferredId = user?.crypto?.defaultChainId || 84532;
        const preferred =
          usable.find((c) => c.chainId === preferredId) ||
          usable.find((c) => c.chainId === 84532) ||
          usable[0];
        if (preferred) setChainId(preferred.chainId);
      })
      .catch((err) => {
        if (!active) return;
        setChainsError(
          err?.response?.data?.error ||
            "The list of networks could not be loaded, so no address can be issued right now. This is a connection problem, not a setting. Close this and try again."
        );
      });
    return () => {
      active = false;
    };
  }, [user?.crypto?.defaultChainId]);

  const chain = useMemo(
    () => (chains || []).find((c) => c.chainId === chainId) || null,
    [chains, chainId]
  );

  const tokens = useMemo(() => (chain && chain.stables) || [], [chain]);

  useEffect(() => {
    setTokenSymbol(tokens.length ? tokens[0].symbol : null);
  }, [tokens]);

  useEffect(() => {
    if (!chainId || !walletPresent) return;
    let active = true;
    setQuote(null);
    setQuoteError("");
    fetchQuote({ debtId: debt._id, chainId, tokenSymbol })
      .then((q) => {
        if (active) setQuote(q);
      })
      .catch((err) => {
        if (active) setQuoteError(err?.response?.data?.error || "Could not price this invoice.");
      });
    return () => {
      active = false;
    };
  }, [chainId, tokenSymbol, debt._id, walletPresent]);

  async function issue(e) {
    e.preventDefault();
    setError("");
    if (!chain) return setError("Choose a network first.");
    if (!password) return setError("Enter your wallet password.");

    let master;
    try {
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
      setBusy("Reserving an address");
      const alloc = await allocateIndex(chain.chainId);

      const address = deriveAddressFromWallet(master, alloc.derivationIndex);

      setBusy("Saving the address");
      const saved = await createPaymentAddress({
        debtId: debt._id,
        chainId: chain.chainId,
        address,
        derivationIndex: alloc.derivationIndex,
        tokenSymbol: tokenSymbol || undefined,
      });

      const stored = saved && saved.paymentAddress;
      if (
        !stored ||
        String(stored.address).toLowerCase() !== address.toLowerCase() ||
        Number(stored.derivationIndex) !== alloc.derivationIndex
      ) {
        setBusy("Revoking the mismatched address");
        let revoked = false;
        if (stored && stored._id) {
          try {
            await revokePaymentAddress(stored._id);
            revoked = true;
          } catch {
          }
        }
        throw new Error(
          revoked
            ? "The address that was saved does not match the one this wallet derived, so it has been revoked and will not be shown to the payer or attached to any reminder. Try again."
            : "The address that was saved does not match the one this wallet derived, and it could NOT be revoked automatically. It may still be attached to reminders for this invoice. Open the crypto section on this invoice and revoke it by hand before sending anything to your client."
        );
      }

      setPassword("");
      onCreated(saved);
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || "";
      setError(msg || "Could not create the payment address.");
      setBusy("");
    }
  }

  if (!walletPresent) {
    return (
      <Modal label="Crypto payment" view="crypto" onClose={onClose}>
        <Head onClose={onClose} title="Crypto payment" />
        <section className="card">
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
        </section>
        <div className="pv-foot">
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

  if (cannotDerive) {
    return (
      <Modal label="Crypto payment" view="crypto" onClose={onClose}>
        <Head onClose={onClose} title="Crypto payment" />
        <section className="card">
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
        </section>
        <div className="pv-foot">
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
  const blocked = Boolean(noChains || chainsError || nothingOwed || alreadyActive || quoteError);

  return (
    <Modal label="Crypto payment" view="crypto" onClose={onClose}>
      <Head
        onClose={onClose}
        title={`Crypto payment for ${debt.debtorName}`}
        support={
          <>
            This invoice gets an address of its own, so anything arriving at it is matched to this
            debt automatically. The address is derived from your wallet inside this browser and only
            the public address is stored.
          </>
        }
      />

      {quote && quote.rateStale && (
        <div className="row wrap">
          <span className="pill warn">Rate is a fallback, not live</span>
        </div>
      )}

      <form className="pv-form" onSubmit={issue}>
        <section className="card stack">
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

        {tokens.length > 1 && (
          <Field label="Token the payer sends">
            <Select
              value={tokenSymbol || ""}
              onChange={(e) => setTokenSymbol(e.target.value)}
              disabled={Boolean(busy)}
            >
              {tokens.map((t) => (
                <option key={t.symbol} value={t.symbol}>
                  {t.symbol} · {t.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {chainsError && (
          <p className="error-text" style={{ margin: 0 }}>
            {chainsError}
          </p>
        )}

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

        {!quote && !quoteError && !noChains && !chainsError ? (
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
                  {ngn(quote.ngnPerUsd)} per {(quote.token && quote.token.symbol) || "USDC"}
                  <span className="quote-sub">
                    {quote.rateStale ? "fallback rate, not live" : agoLabel(quote.rateTimestamp)}
                  </span>
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
              The {(quote.token && quote.token.symbol) || "stablecoin"} figure is rounded up to
              the cent, so a payer who sends exactly this amount always clears the invoice in
              full. It is locked to the rate above when you create the address, so a later move
              in the rate cannot leave this debtor still owing money.
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

        </section>

        <div className="pv-foot">
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

function Head({ title, support, onClose }) {
  return (
    <PageHeader
      title={title}
      support={support}
      action={
        <Button variant="ghost" icon title="Close" onClick={onClose}>
          <X size={15} />
        </Button>
      }
    />
  );
}
