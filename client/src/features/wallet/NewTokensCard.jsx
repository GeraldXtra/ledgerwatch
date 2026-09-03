import { useState } from "react";
import { ethers } from "ethers";
import { Check, ExternalLink, EyeOff, RotateCcw, ShieldAlert, Sparkles } from "lucide-react";
import TokenLogo from "../../components/TokenLogo";

/**
 * TOKENS THAT ARRIVED UNINVITED.
 *
 * The inbound scan reads every ERC-20 transfer addressed to this wallet, so a
 * token nobody imported can still be noticed. This is where the wallet says
 * so and asks what to do. It recommends; it never decides. On a real network
 * most unsolicited tokens are spam or bait, and a wallet that added them by
 * itself would be doing the attacker's work, so:
 *
 *   - nothing here is added without a click,
 *   - the contract address is always shown, with an explorer link,
 *   - a symbol that copies a verified token on this network is called out,
 *   - a contract that could not be read cannot be added at all, because its
 *     balance could not be shown with correct decimals.
 */

function shorten(a) {
  return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : "";
}

function checksum(a) {
  try {
    return ethers.getAddress(a);
  } catch {
    return a;
  }
}

function amount(t) {
  if (t.firstAmount == null) return null;
  const n = Number(t.firstAmount);
  if (!Number.isFinite(n)) return t.firstAmount;
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

export default function NewTokensCard({
  chain,
  tokens,
  syncFailed = false,
  busyAddress = null,
  error = "",
  onAdd,
  onIgnore,
  onRestore,
}) {
  const [showIgnored, setShowIgnored] = useState(false);
  const fresh = (tokens || []).filter((t) => t.status === "new");
  const ignored = (tokens || []).filter((t) => t.status === "ignored");

  // Nothing to say and nothing went wrong: take no space at all.
  if (fresh.length === 0 && ignored.length === 0 && !syncFailed) return null;

  // A failed scan with nothing else to show still speaks, in one line. "No
  // new tokens" and "could not look" are different facts.
  if (fresh.length === 0 && ignored.length === 0) {
    return (
      <div className="mm-found" role="region" aria-label="New tokens">
        <p className="mm-found-note warn">
          Could not check {chain ? chain.name : "this network"} for new tokens just now. It is
          checked again each time the wallet opens.
        </p>
      </div>
    );
  }

  const list = showIgnored ? [...fresh, ...ignored] : fresh;

  return (
    <div className="mm-found" role="region" aria-label="New tokens">
      <div className="mm-found-head">
        <Sparkles size={15} />
        <span className="grow">
          {fresh.length === 0
            ? "No new tokens waiting"
            : fresh.length === 1
              ? "A token arrived that this wallet did not know about"
              : `${fresh.length} tokens arrived that this wallet did not know about`}
        </span>
        {ignored.length > 0 && (
          <button
            type="button"
            className="mm-linkish"
            onClick={() => setShowIgnored((s) => !s)}
          >
            {showIgnored ? "Hide ignored" : `${ignored.length} ignored`}
          </button>
        )}
      </div>

      {syncFailed && (
        <p className="mm-found-note warn">
          {chain ? chain.name : "The network"} could not be read just now, so this list may be
          behind. It is checked again each time the wallet opens.
        </p>
      )}

      {error && <p className="mm-found-note warn">{error}</p>}

      <ul className="mm-found-list">
        {list.map((t) => {
          const busy = busyAddress === t.address;
          const unreadable = !t.readable;
          const gaveUp = unreadable && t.lookupAttempts >= 4;
          const symbol = t.symbol || "Unknown token";
          return (
            <li key={t.address} className={t.status === "ignored" ? "mm-found-row dim" : "mm-found-row"}>
              <TokenLogo symbol={t.symbol || "?"} unknown={unreadable} />
              <span className="mm-found-main">
                <span className="mm-found-name">
                  {symbol}
                  {t.name && t.name !== t.symbol && (
                    <span className="mm-found-sub"> {t.name}</span>
                  )}
                  {t.status === "ignored" && (
                    <span className="lw-label" style={{ letterSpacing: "0.12em" }}>
                      ignored
                    </span>
                  )}
                </span>
                <span className="mm-found-meta num">
                  {amount(t) != null
                    ? `${amount(t)} ${t.symbol} arrived`
                    : unreadable
                      ? gaveUp
                        ? "This contract did not answer as a standard token"
                        : "Reading the contract, checked again on the next open"
                      : "Amount unavailable"}
                  {t.firstSeenAt ? ` · ${when(t.firstSeenAt)}` : ""}
                </span>
                <span className="mm-found-meta">
                  <code className="num">{shorten(checksum(t.address))}</code>
                  {t.firstFrom && (
                    <>
                      {" "}
                      from <code className="num">{shorten(checksum(t.firstFrom))}</code>
                    </>
                  )}
                  {t.explorer && (
                    <>
                      {" "}
                      <a
                        className="mm-found-link"
                        href={t.explorer}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        explorer <ExternalLink size={11} />
                      </a>
                    </>
                  )}
                </span>
                {t.impersonates && (
                  <span className="mm-found-warn">
                    <ShieldAlert size={13} />
                    Calls itself {t.impersonates}, but this is not the verified {t.impersonates}{" "}
                    contract on {chain ? chain.name : "this network"}. Anyone can deploy a token
                    with any name. Treat it as bait unless you know who sent it.
                  </span>
                )}
              </span>
              <span className="mm-found-actions">
                {t.status === "ignored" ? (
                  <button
                    type="button"
                    className="mm-linkish"
                    disabled={busy}
                    onClick={() => onRestore && onRestore(t)}
                    title="Bring it back to the list"
                  >
                    <RotateCcw size={13} /> Restore
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="mm-found-btn primary"
                      disabled={busy || unreadable}
                      onClick={() => onAdd && onAdd(t)}
                      title={
                        unreadable
                          ? "Cannot be added until its contract can be read"
                          : "Show this token in your wallet"
                      }
                    >
                      <Check size={13} /> {busy ? "Adding..." : "Add"}
                    </button>
                    <button
                      type="button"
                      className="mm-found-btn"
                      disabled={busy}
                      onClick={() => onIgnore && onIgnore(t)}
                      title="Keep it off your lists"
                    >
                      <EyeOff size={13} /> Ignore
                    </button>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {fresh.length > 0 && (
        <p className="mm-found-note">
          Nothing is added by itself. Unsolicited tokens on a real network are usually spam or
          bait, so check the contract on the explorer before trusting one.
        </p>
      )}
    </div>
  );
}
