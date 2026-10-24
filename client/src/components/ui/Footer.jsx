import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <span>Your keys stay in your browser, and you approve every transaction.</span>
        <span className="site-footer-links">
          <Link to="/docs">Guide</Link>
          <Link to="/docs/troubleshooting">Help</Link>
          <Link to="/contact">Contact</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </span>
      </div>
    </footer>
  );
}
