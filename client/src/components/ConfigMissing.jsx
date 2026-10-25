export default function ConfigMissing() {
  return (
    <div className="center-screen">
      <div className="card auth-card stack" style={{ textAlign: "center" }}>
        <div className="wordmark" style={{ fontSize: 18 }}>
          Ledger<span className="tick">Watch</span>
        </div>
        <h2 className="section-title">LedgerWatch cannot reach its server</h2>
        <p className="muted small">
          This copy of the site was built without the address of its server, so nothing can load.
          Your account and your data are safe.
        </p>
        <p className="muted small">
          If you run this site, set VITE_API_URL in the build settings and deploy again.
        </p>
      </div>
    </div>
  );
}
