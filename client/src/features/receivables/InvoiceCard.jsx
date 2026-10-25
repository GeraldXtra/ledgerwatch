import { useState } from "react";
import { Check, Copy, FileDown, Link2, RefreshCw } from "lucide-react";
import http from "../../api/http";
import { Button, Card } from "../../components/ui";

async function errorText(err, fallback) {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      return parsed.error || fallback;
    } catch {
      return fallback;
    }
  }
  return data?.error || fallback;
}

export default function InvoiceCard({ debt, onNumbered }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmRenew, setConfirmRenew] = useState(false);
  const [number, setNumber] = useState(debt.invoiceNumber || "");

  async function download() {
    setBusy("pdf");
    setError("");
    try {
      const res = await http.get(`/api/debts/${debt._id}/invoice.pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${number || debt.invoiceNumber || "invoice"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      setError(await errorText(err, "The PDF could not be made just now. Try again in a moment."));
    } finally {
      setBusy("");
    }
  }

  async function share(renew = false) {
    setBusy(renew ? "renew" : "share");
    setError("");
    setCopied(false);
    try {
      const { data } = await http.post(`/api/debts/${debt._id}/share`, { renew });
      setLink(data.url);
      setConfirmRenew(false);
      if (data.invoiceNumber && data.invoiceNumber !== number) {
        setNumber(data.invoiceNumber);
        if (onNumbered) onNumbered(data.invoiceNumber);
      }
      try {
        await navigator.clipboard.writeText(data.url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      } catch {
        setError("Your browser blocked copying. Select the link below and copy it by hand.");
      }
    } catch (err) {
      setError(await errorText(err, "The payment page link could not be made just now."));
    } finally {
      setBusy("");
    }
  }

  return (
    <Card
      title="Invoice"
      subtitle={number ? `${number}. Send the PDF, or share the payment page so your customer can see what they owe and pay.` : "Send the PDF, or share the payment page so your customer can see what they owe and pay."}
    >
      <div className="stack-sm">
        <div className="row wrap">
          <Button onClick={download} disabled={busy === "pdf"}>
            <FileDown size={14} /> {busy === "pdf" ? "Making the PDF" : "Download PDF"}
          </Button>
          <Button onClick={() => share(false)} disabled={busy === "share"}>
            {copied ? <Check size={14} /> : <Link2 size={14} />} {copied ? "Link copied" : "Copy payment page link"}
          </Button>
          {link && !confirmRenew && (
            <Button variant="ghost" onClick={() => setConfirmRenew(true)}>
              <RefreshCw size={14} /> Make a new link
            </Button>
          )}
        </div>
        {link && (
          <div className="row wrap tight">
            <code className="wallet-address">{link}</code>
            <Button
              size="sm"
              variant="ghost"
              icon
              title="Copy the link"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                } catch {
                  setError("Your browser blocked copying. Select the link and copy it by hand.");
                }
              }}
            >
              <Copy size={14} />
            </Button>
          </div>
        )}
        {confirmRenew && (
          <div className="settings-note">
            <span>
              A new link stops the old one working. Anyone you already sent it to will need the new link.
            </span>
            <div className="row wrap">
              <Button size="sm" variant="primary" onClick={() => share(true)} disabled={busy === "renew"}>
                Make the new link
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmRenew(false)}>
                Keep the current link
              </Button>
            </div>
          </div>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
    </Card>
  );
}
