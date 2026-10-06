import { ethers } from "ethers";
import { ExternalLink, TriangleAlert } from "lucide-react";

/**
 * WHERE THIS ADDRESS CAME FROM, SAID OUT LOUD, BEFORE ANY MONEY MOVES.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Trading used to be limited to the dozen assets `chains.js` carries, every one
 * of them read off the live chain by `npm run verify:chains`. The resolver
 * widened that to any coin with a contract on the chain, which is thousands,
 * and the address for those comes from an outside index rather than from a
 * person who checked it.
 *
 * That is a defensible source. What was not defensible was shipping it silently:
 * the resolved address was never displayed anywhere, the result was labelled
 * "verified", and the only warning fired when the contract's symbol differed
 * from the listing — a condition an attacker controls both sides of, so the
 * crafted case produced no warning at all.
 *
 * THE CHECK THAT CANNOT WORK ALONE. The resolver compares the index's decimals
 * against the contract's. Both the address and the decimals come from the same
 * index entry, so that comparison is one source checked against itself. It
 * catches a stale or mistaken listing, which is the common case and worth
 * having. It cannot catch a listing built to pass it.
 *
 * The realistic bad path needs nobody to be compromised: a user searches a
 * popular ticker, several similar listings come back with similar names and
 * logos, and they pick the wrong one. No system can tell which they meant. The
 * only thing that can is the user, looking at the address, once.
 *
 * ---------------------------------------------------------------------------
 * SO THIS IS A GATE, NOT A BANNER
 * ---------------------------------------------------------------------------
 * It shows the checksummed address, links the explorer, and names the token as
 * the CONTRACT reports it rather than as the index does. It blocks the trade
 * until the owner says they have looked. That is the same rule the wallet
 * already applies to a token that arrives uninvited — recommended, never
 * auto-added, the owner clicks (CLAUDE.md hard rule 10) — applied at the other
 * door into the same risk.
 *
 * Asked once per token per browser. Repeating it on every trade would train
 * people to click it without reading, which is worse than not asking.
 *
 * Registry tokens never see this: their provenance is a verification run
 * against the chain, which is a different and stronger claim.
 */

const ACK_KEY = "ledgerwatch.token.acknowledged";

function ackId(chainId, address) {
  return `${chainId}:${String(address).toLowerCase()}`;
}

/** Has the owner already looked at this exact contract on this exact chain? */
export function isTokenAcknowledged(chainId, address) {
  if (!chainId || !address) return false;
  try {
    const raw = localStorage.getItem(ACK_KEY);
    if (!raw) return false;
    const list = JSON.parse(raw);
    return Array.isArray(list) && list.includes(ackId(chainId, address));
  } catch {
    // Storage unavailable or corrupt. Asking again is the safe direction: the
    // cost is one extra click, and the cost of guessing "yes" is a wrong token.
    return false;
  }
}

export function acknowledgeToken(chainId, address) {
  if (!chainId || !address) return;
  try {
    const raw = localStorage.getItem(ACK_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(list) ? list : [];
    const id = ackId(chainId, address);
    if (!next.includes(id)) next.push(id);
    // Bounded. This is a convenience list, not a ledger, and an unbounded array
    // in localStorage is a slow leak nobody ever notices.
    localStorage.setItem(ACK_KEY, JSON.stringify(next.slice(-500)));
  } catch {
    /* not remembering it costs one extra click next time, which is harmless */
  }
}

/** Does this token need the owner to look at it before a live trade? */
export function needsAcknowledgement(token) {
  return Boolean(token && token.provenance === "coingecko");
}

/**
 * @param {{token:object, chain:object, checked:boolean, onChange:(v:boolean)=>void, disabled?:boolean}} props
 */
export default function TokenProvenanceNotice({ token, chain, checked, onChange, disabled }) {
  if (!needsAcknowledgement(token)) return null;

  // Checksummed for display. The mixed case IS the checksum, so it is the form
  // a person can actually compare against an explorer.
  let address = token.address;
  try {
    address = ethers.getAddress(token.address);
  } catch {
    /* already refused upstream if malformed; show it as given rather than hide it */
  }

  const explorer = token.explorer || (chain?.explorer ? `${chain.explorer}/token/${address}` : null);

  return (
    <div className="against-note stack" role="group" aria-label="Check this contract">
      <div className="row">
        <TriangleAlert size={15} />
        <span>
          <strong>{token.symbol}</strong> is not one of the contracts checked by hand for{" "}
          {chain?.name || "this network"}. Its address comes from the public coin index, and the
          only things confirmed on the chain are that a contract is there, that it reports this
          symbol and {token.decimals} decimals, and that it is not copying a known token&apos;s
          symbol. Check the address before you buy.
        </span>
      </div>

      <div className="stack-tight">
        <div className="overline">Contract address</div>
        <div className="num" style={{ wordBreak: "break-all" }}>
          {address}
        </div>
        {explorer && (
          <a className="tx-hash-link" href={explorer} target="_blank" rel="noopener noreferrer">
            Open it on the explorer <ExternalLink size={12} />
          </a>
        )}
      </div>

      <label className="toggle-row">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          <span className="toggle-title">I have checked this address and it is the token I mean</span>
          <span className="muted small">
            Asked once for this token on this network. Anyone can list a coin under a familiar name,
            and the address is the only part that cannot be copied.
          </span>
        </span>
      </label>
    </div>
  );
}
