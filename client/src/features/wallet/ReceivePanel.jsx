import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Droplets } from "lucide-react";
import { Button } from "../../components/ui";

// Receive screen: address, a scannable QR, copy-to-clipboard, and the chain faucet.
export default function ReceivePanel({ address, chain }) {
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    if (!address) return;
    QRCode.toDataURL(address, { width: 220, margin: 1, color: { dark: "#0A1428", light: "#FFFFFF" } })
      .then((url) => {
        if (active) setQr(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [address]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the address is visible to copy manually */
    }
  }

  return (
    <div className="stack">
      <div>
        <h3 className="section-title">Receive {chain?.nativeSymbol}</h3>
        <p className="muted small" style={{ margin: "4px 0 0" }}>
          Share this address to receive testnet funds on {chain?.name}.
        </p>
      </div>

      <div className="receive-card">
        {qr ? <img src={qr} alt="Wallet address QR code" className="receive-qr" /> : <div className="receive-qr receive-qr-empty" />}
        <code className="wallet-address">{address}</code>
        <Button variant="secondary" onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy address"}
        </Button>
      </div>

      {chain?.faucet && (
        <a className="faucet-link" href={chain.faucet} target="_blank" rel="noopener noreferrer">
          <Droplets size={14} /> Get free {chain.nativeSymbol} from the {chain.name} faucet
        </a>
      )}
    </div>
  );
}
