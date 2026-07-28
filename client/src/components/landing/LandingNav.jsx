import { Link } from "react-router-dom";
import LogoMark from "../LogoMark";

export default function LandingNav() {
  return (
    <header className="landing-nav">
      <div className="landing-nav-inner">
        <Link to="/" className="landing-brand" aria-label="LedgerWatch home">
          <LogoMark size={30} />
          <span className="wordmark">
            Ledger<span className="tick">Watch</span>
          </span>
        </Link>

        <nav className="landing-nav-links" aria-label="Sections">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
        </nav>

        <div className="row">
          <Link to="/login" className="btn btn-ghost">
            Sign in
          </Link>
          <Link to="/login" className="btn btn-primary">
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
