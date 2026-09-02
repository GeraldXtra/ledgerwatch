import { useState } from "react";
import { ethers } from "ethers";
import { Check, Search, ShieldAlert, TriangleAlert, X } from "lucide-react";
import { Button, Field, Input, Modal } from "../../components/ui";
import { getProvider, ERC20_ABI } from "./provider";

/**
 * Add any ERC-20 by contract address.
 *
 * DECIMALS ARE READ FROM THE CONTRACT, NEVER GUESSED. Assuming 6 because a token
 * is called USDC would misread BNB Chain's USDC — which uses 18 — by a factor of
 * 10^12. The same reasoning applies to the symbol: what the contract says is what
 * is shown, because anyone can deploy a contract calling itself anything.
 */
export default function AddTokenModal({ chain, address, existing = [], onClose, onAdd }) {
  const [input, setInput] = useState("");
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function lookup(e) {
    e.preventDefault();
    setError("");
    setFound(null);

    const addr = input.trim();
    if (!ethers.isAddress(addr)) {
      return setError("That is not a valid contract address.");
    }
    if (existing.some((t) => t.address.toLowerCase() === addr.toLowerCase())) {
      return setError("That token is already in your list for this network.");
    }

    setBusy(true);
    try {
      const provider = getProvider(chain.chainId);

      // Nothing deployed here at all is the most common paste error — a wallet
      // address, or the right token on the wrong network.
      const code = await provider.getCode(addr);
      if (!code || code === "0x") {
        setError(
          `No contract exists at that address on ${chain.name}. Check you have the right network, because the same token has a different address on each chain.`
        );
        return;
      }

      const c = new ethers.Contract(addr, ERC20_ABI, provider);
      const [symbol, decimals] = await Promise.all([c.symbol(), c.decimals()]);

      let balance = 0n;
      try {
        balance = await c.balanceOf(address);
      } catch {
        /* balance is a nicety; the token can still be added */
      }

      setFound({
        address: ethers.getAddress(addr),
        symbol: String(symbol),
        decimals: Number(decimals),
        balance: ethers.formatUnits(balance, Number(decimals)),
      });
    } catch (err) {
      setError(
        /call revert|could not decode/i.test(err.message || "")
          ? "That contract did not answer as an ERC-20 token. It may be a different kind of contract."
          : err.message || "Could not read that contract."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal label="Add a token" onClose={onClose}>
      <div className="row space-between">
        <h3 className="section-title">Add a token on {chain.name}</h3>
        <Button variant="ghost" icon title="Close" onClick={onClose}>
          <X size={15} />
        </Button>
      </div>

      <form className="stack" onSubmit={lookup}>
        <Field label="Token contract address">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="0x…"
            autoFocus
          />
        </Field>
        {!found && (
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="secondary" type="submit" disabled={busy}>
              <Search size={14} /> {busy ? "Reading contract…" : "Look up"}
            </Button>
          </div>
        )}
      </form>

      {error && (
        <div className="against-note">
          <TriangleAlert size={15} />
          <span>{error}</span>
        </div>
      )}

      {found && (
        <>
          <dl className="trade-quote">
            <div>
              <dt>Symbol</dt>
              <dd className="num">{found.symbol}</dd>
            </div>
            <div>
              <dt>Decimals</dt>
              <dd className="num">
                {found.decimals}
                <span className="quote-sub">read from the contract, not assumed</span>
              </dd>
            </div>
            <div>
              <dt>Your balance</dt>
              <dd className="num">
                {Number(found.balance).toLocaleString(undefined, { maximumFractionDigits: 8 })}{" "}
                {found.symbol}
              </dd>
            </div>
            <div>
              <dt>Address</dt>
              <dd className="num sweep-dest">{found.address}</dd>
            </div>
          </dl>

          <div className="against-note">
            <ShieldAlert size={15} />
            <span>
              <strong>This token is unverified.</strong> Anyone can deploy a contract and call it{" "}
              {found.symbol}, including a copy of a well known token. LedgerWatch is only reporting
              what this contract says about itself. Add it only if you know where the address came
              from.
            </span>
          </div>

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={() => setFound(null)}>
              Back
            </Button>
            <Button variant="primary" onClick={() => onAdd({ ...found, chainId: chain.chainId })}>
              <Check size={14} /> Add {found.symbol}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
