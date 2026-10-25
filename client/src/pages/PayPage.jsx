import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import QRCode from "qrcode";
import { Check, Copy, FileDown, Landmark, ShieldAlert, Wallet } from "lucide-react";
import http from "../api/http";
import { API_BASE } from "../api/base";
import PublicShell from "../components/PublicShell";
import usePageMeta from "../components/usePageMeta";
import { Card, SkeletonLines, StatusPill } from "../components/ui";
import { ngn, shortDate } from "../features/receivables/format";

function CopyValue({ label, value, mono = false }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setFailed(true);
    }
  }
  return (
    <div className="pay-row">
      <span className="muted small">{label}</span>
      <span className="row tight">
        <span className={mono ? "num mono-strong pay-value" : "mono-strong pay-value"}>{value}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={copy} aria-label={`Copy ${label.toLowerCase()}`}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </span>
      {failed && <span className="error-text small">Your browser blocked copying. Select it and copy it by hand.</span>}
    </div>
  );
}

function CryptoBlock({ crypto }) {
  const [qr, setQr] = useState("");
  const [qrFailed, setQrFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setQrFailed(false);
    QRCode.toDataURL(crypto.address, { width: 200, margin: 1, color: { dark: "#0A1428", light: "#FFFFFF" } })
      .then((url) => active && setQr(url))
      .catch(() => active && setQrFailed(true));
    return () => {
      active = false;
    };
  }, [crypto.address]);

  return (
    <Card title={`Pay in ${crypto.tokenSymbol} on ${crypto.network}`} className="pay-card">
      <div className="stack-sm">
        {qr ? (
          <img src={qr} alt={`QR code for ${crypto.address}`} className="receive-qr" />
        ) : qrFailed ? (
          <p className="error-text">The QR code could not be drawn. Copy the address instead.</p>
        ) : null}
        <CopyValue label="Amount to send" value={`${crypto.expected} ${crypto.tokenSymbol}`} mono />
        <CopyValue label="Address" value={crypto.address} mono />
        <p className="settings-note danger">
          <ShieldAlert size={15} />
          Send only {crypto.tokenSymbol} on {crypto.network}. Anything else sent to this address may be lost.
          {crypto.testnet ? " This is a test network, so it carries no real money." : ""}
        </p>
        {crypto.expiresAt && (
          <p className="muted small">This address accepts payment until {shortDate(crypto.expiresAt)}.</p>
        )}
      </div>
    </Card>
  );
}

export default function PayPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const invoice = data && data.invoice;
  usePageMeta({
    title: invoice ? `Invoice ${invoice.invoiceNumber || ""} from ${invoice.businessName} · LedgerWatch` : "Invoice · LedgerWatch",
    noindex: true,
  });

  useEffect(() => {
    let active = true;
    http
      .get(`/api/public/invoices/${encodeURIComponent(token)}`)
      .then(({ data: body }) => active && setData(body))
      .catch((err) => {
        if (active) setError(err?.response?.data?.error || "This invoice could not be loaded just now. Try again in a moment.");
      });
    return () => {
      active = false;
    };
  }, [token]);

  const pdfUrl = `${API_BASE}/api/public/invoices/${encodeURIComponent(token)}/invoice.pdf`;
  const paid = invoice && invoice.balance <= 0;

  return (
    <PublicShell bare>
      <div className="pay-page stack">
        {error ? (
          <Card title="This link does not open an invoice">
            <p className="muted">{error}</p>
          </Card>
        ) : !invoice ? (
          <Card>
            <SkeletonLines count={5} />
          </Card>
        ) : (
          <>
            <div className="pay-head">
              <div>
                <span className="overline">Invoice {invoice.invoiceNumber}</span>
                <h1>{invoice.businessName}</h1>
                <p className="muted">For {invoice.debtorName}</p>
              </div>
              <StatusPill status={invoice.status} />
            </div>

            <Card title={paid ? "This invoice is paid" : "What is owed"}>
              <div className="stack-sm">
              <div className="detail-stats">
                <div className="detail-stat">
                  <span className="overline">Issued</span>
                  <span className="num">{shortDate(invoice.issuedAt)}</span>
                </div>
                <div className="detail-stat">
                  <span className="overline">Due</span>
                  <span className="num">{shortDate(invoice.dueDate)}</span>
                </div>
                <div className="detail-stat">
                  <span className="overline">Total</span>
                  <span className="num">{ngn(invoice.amount)}</span>
                </div>
                <div className="detail-stat">
                  <span className="overline">Paid so far</span>
                  <span className="num value-pos">{ngn(invoice.amountPaid)}</span>
                </div>
                <div className="detail-stat">
                  <span className="overline">Balance due</span>
                  <span className={`num ${paid ? "value-pos" : "value-neg"}`}>{ngn(invoice.balance)}</span>
                </div>
              </div>
              {invoice.note && <p className="muted small">{invoice.note}</p>}
              {paid && <p className="muted">Thank you. Nothing more is owed on this invoice.</p>}
              <div className="row wrap">
                <a className="btn btn-secondary" href={pdfUrl}>
                  <FileDown size={14} /> Download the invoice (PDF)
                </a>
              </div>
              </div>
            </Card>

            {!paid && invoice.bank && (
              <Card title="Pay by bank transfer" className="pay-card">
                <div className="stack-sm">
                  <span className="row tight muted small">
                    <Landmark size={15} /> Pay into this account and keep your transfer receipt.
                  </span>
                  {invoice.bank.bankName && <CopyValue label="Bank" value={invoice.bank.bankName} />}
                  {invoice.bank.accountName && <CopyValue label="Account name" value={invoice.bank.accountName} />}
                  <CopyValue label="Account number" value={invoice.bank.accountNumber} mono />
                  <CopyValue label="Amount" value={ngn(invoice.balance)} mono />
                </div>
              </Card>
            )}

            {!paid && invoice.crypto && <CryptoBlock crypto={invoice.crypto} />}

            {!paid && !invoice.bank && !invoice.crypto && (
              <Card title="How to pay">
                <p className="muted">
                  <Wallet size={15} /> {invoice.businessName} has not added payment details to this page yet. Reply to
                  their message and they will tell you where to pay.
                </p>
              </Card>
            )}

            <p className="muted small">
              This page was made by {invoice.businessName} with LedgerWatch. Questions about this invoice go to{" "}
              {invoice.businessName}, not to LedgerWatch.
            </p>
          </>
        )}
      </div>
    </PublicShell>
  );
}
