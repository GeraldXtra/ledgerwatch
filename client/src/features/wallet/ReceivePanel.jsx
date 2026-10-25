import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Droplets, ExternalLink, Network } from "lucide-react";
import { Button } from "../../components/ui";
import NetworkScopeNotice from "./NetworkScopeNotice";

export default function ReceivePanel({ address, chain }) {
  const [qr, setQr] = useState("");
  const [qrFailed, setQrFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    let active = true;
    if (!address) return;
    setQrFailed(false);
    QRCode.toDataURL(address, { width: 220, margin: 1, color: { dark: "#0A1428", light: "#FFFFFF" } })
      .then((url) => {
        if (active) setQr(url);
      })
      .catch(() => active && setQrFailed(true));
    return () => {
      active = false;
    };
  }, [address]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <div className="stack">
      <div>
        <h3 className="section-title row">
          Receive
          <span className="chain-chip">
            <Network size={12} /> {chain?.name}
          </span>
        </h3>
        <p className="muted small" style={{ margin: "4px 0 0" }}>
          Share this address to receive funds <strong>on {chain?.name}</strong>. Anything sent on a
          different network will not appear here.
        </p>
      </div>

      <div className="receive-card">
        {qr ? (
          <img src={qr} alt="Wallet address QR code" className="receive-qr" />
        ) : qrFailed ? (
          <p className="error-text">The QR code could not be drawn. Copy the address instead.</p>
        ) : (
          <div className="receive-qr receive-qr-empty" />
        )}
        <code className="wallet-address">{address}</code>
        <Button variant="secondary" onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy address"}
        </Button>
        {copyFailed && <p className="error-text">Your browser blocked copying. Select the address and copy it by hand.</p>}
      </div>

      {chain?.faucet && (
        <a className="faucet-link" href={chain.faucet} target="_blank" rel="noopener noreferrer">
          <Droplets size={14} /> Get free test {chain.nativeSymbol} from a faucet{" "}
          <ExternalLink size={12} />
        </a>
      )}

      <NetworkScopeNotice chain={chain} />
    </div>
  );
}
