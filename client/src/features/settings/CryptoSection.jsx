import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button, Field, Input, Select, useToast } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { fetchChains } from "../receivables/cryptoApi";
import { getStoredAddress } from "../wallet/keystore";

// Mirrors the clamps in server/src/services/cryptoSettings.service.js.
const MIN_CONFIRMATIONS = 1;
/**
 * 300, WHICH IS WHAT THE SERVER ACTUALLY ACCEPTS.
 *
 * This said 200 under a comment claiming to mirror the server, and the server
 * had already been raised to 300 for a stated reason: Arbitrum One's own
 * recommended depth is 240, and at a cap of 200 an owner who "confirmed" the
 * default by typing it was silently clamped to something shallower than the
 * default. On the client the consequence was worse than a clamp — a browser
 * enforces a number field's max before it will submit at all, so typing 240 for
 * Arbitrum stopped the WHOLE crypto settings form from saving, with a small
 * browser tooltip and no other explanation, taking every other change on the
 * page down with it.
 */
const MAX_CONFIRMATIONS = 300;
const MIN_EXPIRY_HOURS = 1;
const MAX_EXPIRY_HOURS = 720;

/**
 * The per-chain defaults, so the field can say what it is overriding rather than
 * showing a bare empty box, and so the "you have gone below the recommended
 * depth" warning has something true to compare against.
 *
 * EVERY REAL NETWORK WAS MISSING FROM THIS TABLE. Only the five testnets were
 * listed, and the fallback for anything else was 12. So BNB Chain's box read
 * "12 (recommended)" when the depth the server actually uses is 135 — an
 * elevenfold understatement — and because the red warning compared against the
 * same 12, an owner who typed 20 for BNB Chain (about nine seconds of chain
 * time, on a network where money is real) was told nothing at all. CLAUDE.md
 * gotcha 2 is explicit that depths come from measured block times and are raised
 * and never lowered; this screen was quietly inviting the opposite.
 *
 * Mirrors DEFAULT_CONFIRMATIONS in server/src/config/derivation.js. The server
 * is the authority and does not publish these on /api/wallet/chains yet, so this
 * copy has to be kept in step by hand until it does.
 */
const DEFAULT_CONFIRMATIONS = {
  // ---- testnets ----
  11155111: 12, // Ethereum Sepolia
  84532: 5, // Base Sepolia
  421614: 5, // Arbitrum Sepolia
  11155420: 5, // Optimism Sepolia
  80002: 5, // Polygon Amoy

  // ---- mainnets: real money, measured block times ----
  1: 12, // Ethereum
  8453: 30, // Base
  10: 30, // OP Mainnet
  42161: 240, // Arbitrum One
  137: 135, // Polygon
  56: 135, // BNB Chain, at the measured 0.45s block
  43114: 60, // Avalanche C-Chain
};

/**
 * The recommended depth for a chain.
 *
 * A chain this table does not know is not given a made up 12: an unknown
 * mainnet default is far likelier to be deeper than 12 than shallower, so
 * inventing one would understate it and suppress the warning. Unknown means the
 * hint and the warning both stand down and say nothing.
 */
function recommendedDepth(chainId) {
  const v = DEFAULT_CONFIRMATIONS[chainId];
  return Number.isFinite(v) ? v : null;
}

export default function CryptoSection() {
  const { user, updateProfile } = useAuth();
  const toast = useToast();

  const c = user.crypto || {};
  const [form, setForm] = useState({
    enabled: c.enabled !== false,
    defaultChainId: c.defaultChainId || 84532,
    expiryHours: c.expiryHours || 72,
    sweepDestination: c.sweepDestination || "",
    notifyOnDetected: c.notifyOnDetected !== false,
  });
  const [overrides, setOverrides] = useState(() => ({ ...(c.confirmationOverrides || {}) }));
  const [chains, setChains] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchChains()
      .then(setChains)
      .catch(() => setChains([]));
  }, []);

  const walletAddress = getStoredAddress();
  const set = (k) => (e) =>
    setForm((f) => ({
      ...f,
      [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      // Blank means "my own wallet", which the server stores as null rather than
      // as an empty string.
      const clean = { ...form, sweepDestination: form.sweepDestination.trim() || null };
      const confirmationOverrides = {};
      for (const [chainId, value] of Object.entries(overrides)) {
        if (value !== "" && value != null) confirmationOverrides[chainId] = Number(value);
      }
      await updateProfile({ crypto: { ...clean, confirmationOverrides } });
      toast("Crypto payment settings saved.", { type: "success" });
    } catch (err) {
      setError(err?.response?.data?.error || "Could not save these settings");
    } finally {
      setBusy(false);
    }
  }

  const lowered = chains.filter((ch) => {
    const recommended = recommendedDepth(ch.chainId);
    if (recommended == null) return false;
    const v = Number(overrides[ch.chainId]);
    return Number.isFinite(v) && v > 0 && v < recommended;
  });

  return (
    <form className="stack" onSubmit={save}>
      <div className="settings-head">
        <h2 className="section-title">Crypto payments</h2>
        <p className="muted small">
          Give each invoice its own blockchain address so a client can settle in stablecoin. The
          network is chosen per invoice, and the real ones are among them.
        </p>
      </div>

      <div className="settings-section">
        <div className="overline">Accepting crypto</div>
        <label className="toggle-row">
          <input type="checkbox" checked={form.enabled} onChange={set("enabled")} />
          <span>
            <span className="toggle-title">Offer crypto payment on invoices</span>
            <span className="muted small">
              When off, the Crypto payment action is hidden and no new addresses can be issued.
              Addresses already out there keep being watched, so money in flight is never lost.
            </span>
          </span>
        </label>

        <label className="toggle-row">
          <input
            type="checkbox"
            checked={form.notifyOnDetected}
            onChange={set("notifyOnDetected")}
          />
          <span>
            <span className="toggle-title">Notify me as soon as a payment is detected</span>
            <span className="muted small">
              Off means you are only told once it has confirmed and settled the invoice.
            </span>
          </span>
        </label>
      </div>

      <div className="settings-section stack">
        <div>
          <div className="overline">New addresses</div>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            Applied to addresses issued from now on. Existing ones keep the terms they were
            created with.
          </p>
        </div>

        <div className="grid2">
          <Field label="Default network">
            <Select
              value={form.defaultChainId}
              onChange={(e) => setForm((f) => ({ ...f, defaultChainId: Number(e.target.value) }))}
              disabled={chains.length === 0}
            >
              {chains.map((ch) => (
                <option key={ch.chainId} value={ch.chainId}>
                  {ch.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Accept payment for (hours)">
            <Input
              type="number"
              min={MIN_EXPIRY_HOURS}
              max={MAX_EXPIRY_HOURS}
              value={form.expiryHours}
              onChange={set("expiryHours")}
            />
          </Field>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Between {MIN_EXPIRY_HOURS} hour and {MAX_EXPIRY_HOURS} hours (30 days). After that an
          address stops accepting payment, but is still watched for 30 more days so a late
          payment is never lost.
        </p>
      </div>

      <div className="settings-section stack">
        <div>
          <div className="overline">Where swept funds go</div>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            Leave blank to sweep into the wallet on this device
            {walletAddress ? ` (${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)})` : ""}.
          </p>
        </div>
        <Field label="Sweep destination">
          <Input
            value={form.sweepDestination}
            onChange={set("sweepDestination")}
            placeholder="0x… or leave blank"
            spellCheck={false}
          />
        </Field>
        {form.sweepDestination.trim() && (
          <p className="settings-note danger">
            <TriangleAlert size={15} />
            Collected money will be sent here. Check every character: a transfer to a wrong
            address cannot be reversed by anyone.
          </p>
        )}
      </div>

      <div className="settings-section stack">
        <div>
          <div className="overline">Confirmations before settling</div>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            How deep a transaction must be buried before it counts as paid. Blank uses the
            recommended depth for that network.
          </p>
        </div>
        <div className="grid2">
          {chains.map((ch) => (
            <Field key={ch.chainId} label={ch.name}>
              <Input
                type="number"
                min={MIN_CONFIRMATIONS}
                max={MAX_CONFIRMATIONS}
                value={overrides[ch.chainId] ?? ""}
                placeholder={
                  recommendedDepth(ch.chainId) != null
                    ? `${recommendedDepth(ch.chainId)} (recommended)`
                    : "the recommended depth"
                }
                onChange={(e) =>
                  setOverrides((o) => ({ ...o, [ch.chainId]: e.target.value }))
                }
              />
            </Field>
          ))}
        </div>
        {lowered.length > 0 && (
          <p className="settings-note danger">
            <TriangleAlert size={15} />
            You have set {lowered.map((ch) => ch.name).join(", ")} below the recommended depth.
            Shallower confirmations settle faster, but a chain reorganisation can undo a
            transaction that shallow, and the invoice would already have been marked paid.
          </p>
        )}
      </div>

      <p className="settings-note">
        <ShieldCheck size={15} />
        Addresses are derived from your own wallet in your browser, and this server only ever
        stores the public address. You need a wallet on this device to issue one.{" "}
        <Link to="/app/wallet">Open Wallet</Link> <ExternalLink size={12} />
      </p>

      {error && <p className="error-text">{error}</p>}

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save crypto settings"}
        </Button>
      </div>
    </form>
  );
}
