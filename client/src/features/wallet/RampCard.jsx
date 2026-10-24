import { useCallback, useEffect, useState } from "react";
import { Banknote, Check, Copy, ExternalLink, TriangleAlert } from "lucide-react";
import http from "../../api/http";
import { Button, Card, Field, Input, Select, StatusPill } from "../../components/ui";

const OUTCOME = {
  "in-progress": { tone: "pending", label: "In progress" },
  "on-hold": { tone: "partial", label: "On hold" },
  completed: { tone: "paid", label: "Completed" },
  failed: { tone: "neg", label: "Did not go through" },
};

function reason(err) {
  return err?.response?.data?.error || err?.message || "the server did not answer";
}

export default function RampCard({ address }) {
  const [status, setStatus] = useState(null);
  const [mode, setMode] = useState("BUY");
  const [coin, setCoin] = useState("USDT");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState(null);
  const [orders, setOrders] = useState([]);
  const [copied, setCopied] = useState(false);

  const loadOrders = useCallback(() => {
    http
      .get("/api/ramp/orders")
      .then(({ data }) => setOrders(data.orders || []))
      .catch(() => setOrders([]));
  }, []);

  useEffect(() => {
    http
      .get("/api/ramp/status")
      .then(({ data }) => setStatus(data))
      .catch((err) => setStatus({ configured: false, reason: `Whether buying with naira is available could not be checked: ${reason(err)}.` }));
    loadOrders();
    const onPush = () => loadOrders();
    window.addEventListener("ledgerwatch:push", onPush);
    return () => window.removeEventListener("ledgerwatch:push", onPush);
  }, [loadOrders]);

  useEffect(() => {
    if (!link) return undefined;
    const t = setTimeout(() => setLink(null), Math.max(0, link.expiresAt - Date.now()));
    return () => clearTimeout(t);
  }, [link]);

  async function prepare(e) {
    e.preventDefault();
    setError("");
    setLink(null);
    if (amount && !(Number(amount) > 0)) return setError("Enter a naira amount above zero, or leave it empty to choose on the next page.");
    setBusy(true);
    try {
      const { data } = await http.post("/api/ramp/session", {
        mode,
        cryptoCurrencyCode: coin,
        fiatAmount: mode === "BUY" && amount ? Number(amount) : undefined,
      });
      setLink({ url: data.widgetUrl, expiresAt: Date.now() + (data.expiresInSeconds || 300) * 1000 });
    } catch (err) {
      setError(`The payment page could not be prepared: ${reason(err)}.`);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("The address could not be copied. Copy it from the Receive page instead.");
    }
  }

  if (!status) return null;

  return (
    <Card
      eyebrow="Naira"
      title="Buy or sell crypto with naira"
      icon={<Banknote size={16} />}
      subtitle="Pay with a Nigerian bank transfer or card to buy, or sell to your bank account. Handled by Transak, a licensed payment provider, which checks your identity the first time."
    >
      {!status.configured ? (
        <p className="muted small" style={{ margin: 0 }}>{status.reason}</p>
      ) : (
        <div className="stack-sm">
          <form className="stack-sm" onSubmit={prepare}>
            <div className="row wrap" style={{ gap: 8 }}>
              <Field label="I want to">
                <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="BUY">Buy</option>
                  <option value="SELL">Sell</option>
                </Select>
              </Field>
              <Field label="Coin">
                <Select value={coin} onChange={(e) => setCoin(e.target.value)}>
                  {status.cryptos.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              {mode === "BUY" && (
                <Field label="Amount in naira, optional">
                  <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" autoComplete="off" />
                </Field>
              )}
            </div>
            {mode === "BUY" && address && (
              <p className="muted small" style={{ margin: 0 }}>
                Transak asks where to send the coins. For {coin} on an EVM network such as Base, BNB Chain or Ethereum, use this wallet:{" "}
                <button type="button" className="mm-acct" onClick={copy}>
                  <span className="addr num">{address.slice(0, 8)}...{address.slice(-6)}</span>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
                . For Bitcoin, Solana, TRON, TON, Litecoin or Dogecoin, copy the address from that network's Receive page, and choose the same network on Transak.
              </p>
            )}
            {mode === "SELL" && (
              <p className="muted small" style={{ margin: 0 }}>
                Transak shows the address to send your {coin} to. Send it from this wallet, on exactly the network Transak names, and the naira goes to your bank account.
              </p>
            )}
            {error && (
              <div className="against-note">
                <TriangleAlert size={15} />
                <span>{error}</span>
              </div>
            )}
            <div className="row wrap">
              <Button variant="primary" type="submit" loading={busy}>
                {mode === "BUY" ? "Prepare to buy" : "Prepare to sell"}
              </Button>
              {link && (
                <a className="btn" href={link.url} target="_blank" rel="noopener" onClick={() => setTimeout(() => setLink(null), 500)}>
                  Open the Transak page <ExternalLink size={14} />
                </a>
              )}
            </div>
            {link && <p className="muted caption" style={{ margin: 0 }}>The page link works once and for five minutes.</p>}
          </form>

          {orders.length > 0 && (
            <ul className="tx-list">
              {orders.map((o) => {
                const s = OUTCOME[o.outcome] || OUTCOME["in-progress"];
                return (
                  <li key={o._id} className="row space-between crypto-tx-row">
                    <div>
                      <div className="num mono-strong">
                        {o.mode === "BUY" ? "Bought" : "Sold"} {o.cryptoAmount ? `${o.cryptoAmount} ` : ""}
                        {o.cryptoCurrency || "crypto"}
                        {o.fiatAmount ? ` for ₦${Number(o.fiatAmount).toLocaleString("en-NG")}` : ""}
                      </div>
                      <div className="muted caption">
                        {new Date(o.updatedAt).toLocaleString()}
                        {o.network ? ` · ${o.network}` : ""}
                      </div>
                    </div>
                    <StatusPill status={s.tone}>{s.label}</StatusPill>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
