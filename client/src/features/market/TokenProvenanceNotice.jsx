import { ethers } from "ethers";
import { ExternalLink, TriangleAlert } from "lucide-react";

const ACK_KEY = "ledgerwatch.token.acknowledged";

function ackId(chainId, address) {
  return `${chainId}:${String(address).toLowerCase()}`;
}

export function isTokenAcknowledged(chainId, address) {
  if (!chainId || !address) return false;
  try {
    const raw = localStorage.getItem(ACK_KEY);
    if (!raw) return false;
    const list = JSON.parse(raw);
    return Array.isArray(list) && list.includes(ackId(chainId, address));
  } catch {
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
    localStorage.setItem(ACK_KEY, JSON.stringify(next.slice(-500)));
  } catch {
  }
}

export function needsAcknowledgement(token) {
  return Boolean(token && token.provenance === "coingecko");
}

export default function TokenProvenanceNotice({ token, chain, checked, onChange, disabled }) {
  if (!needsAcknowledgement(token)) return null;

  let address = token.address;
  try {
    address = ethers.getAddress(token.address);
  } catch {
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
