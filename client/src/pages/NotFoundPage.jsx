import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import PublicShell from "../components/PublicShell";
import usePageMeta from "../components/usePageMeta";

export default function NotFoundPage() {
  usePageMeta({ title: "Page not found · LedgerWatch", noindex: true });

  return (
    <PublicShell>
      <div className="pay-page stack">
        <div>
          <span className="overline">Page not found</span>
          <h1>There is no page at this address</h1>
          <p className="muted">
            The link may be mistyped, or the page may have moved. These are the places most people are looking for.
          </p>
        </div>
        <div className="row wrap">
          <Link className="btn btn-primary" to="/">
            <Compass size={14} /> Go to the front page
          </Link>
          <Link className="btn btn-secondary" to="/docs">
            Read the guide
          </Link>
          <Link className="btn btn-ghost" to="/contact">
            Contact
          </Link>
        </div>
      </div>
    </PublicShell>
  );
}
