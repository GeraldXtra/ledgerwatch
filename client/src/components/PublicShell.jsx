import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import LogoMark from "./LogoMark";

/**
 * The frame around every public page that is not the front page: the guide,
 * the privacy policy, the terms, and the contact form.
 *
 * One white bar with the brand and three links, the page, and a plain footer.
 * Somebody who is signed in gets a single button back into the app instead of
 * the sign in pair, so the guide can be read from inside the product without
 * feeling like leaving it.
 */
export default function PublicShell({ children, wide = false }) {
  const { user } = useAuth();
  // The two text links hide on a phone, where the bar only has room for the
  // brand and one button; both are in the footer and the guide has its own
  // page picker.
  const linkCls = ({ isActive }) =>
    isActive ? "site-nav-link hide-sm active" : "site-nav-link hide-sm";

  return (
    <div className="site pub">
      <header className="site-nav">
        <div className="site-nav-inner">
          <Link to="/" className="brand" aria-label="LedgerWatch front page">
            <LogoMark size={30} />
            <span className="brand-name">
              Ledger<em>Watch</em>
            </span>
          </Link>
          <nav className="site-nav-links" aria-label="Site">
            <NavLink className={linkCls} to="/docs">
              Guide
            </NavLink>
            <NavLink className={linkCls} to="/contact">
              Contact
            </NavLink>
            {user ? (
              <Link className="btn btn-primary" to="/app">
                Open LedgerWatch
              </Link>
            ) : (
              <>
                <Link className="site-nav-link hide-sm" to="/login">
                  Sign in
                </Link>
                <Link className="btn btn-primary" to="/login">
                  Get started
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className={wide ? "site-wrap pub-main wide" : "site-wrap pub-main"}>{children}</main>

      <footer className="site-wrap site-foot">
        <span>LedgerWatch, by Eberechukwu Uchechukwu Gerald. All rights reserved.</span>
        <span className="site-nav-links" style={{ margin: 0 }}>
          <Link to="/docs">Guide</Link>
          <Link to="/docs/safety">Safety</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/contact">Contact</Link>
        </span>
      </footer>
    </div>
  );
}
