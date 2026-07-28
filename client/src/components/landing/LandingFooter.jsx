import LogoMark from "../LogoMark";

export default function LandingFooter() {
  return (
    <footer className="landing-footer">
      <div className="landing-inner landing-footer-inner">
        <div className="row">
          <LogoMark size={24} />
          <span className="wordmark" style={{ fontSize: 14 }}>
            Ledger<span className="tick">Watch</span>
          </span>
        </div>
        <span className="muted caption">
          Automated receivables and market monitoring, built human-in-the-loop.
        </span>
        <span className="faint caption num">© {new Date().getFullYear()} LedgerWatch</span>
      </div>
    </footer>
  );
}
