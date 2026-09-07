import { useEffect, useMemo } from "react";
import { Link, Navigate, NavLink, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import PublicShell from "../components/PublicShell";
import { Blocks } from "../docs/Blocks";
import { GUIDE, GROUPS } from "../docs/guide";

/**
 * THE USER GUIDE
 *
 * Public, so somebody deciding whether to sign up can read how the product
 * works before they do, and reachable from the Help icon inside the app. A
 * sidebar of every page grouped by section, a readable column, and previous
 * and next links at the foot. On a phone the sidebar becomes a select.
 */
export default function DocsPage() {
  const { slug } = useParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const wanted = slug || GUIDE[0].slug;
  const index = GUIDE.findIndex((p) => p.slug === wanted);
  const page = index >= 0 ? GUIDE[index] : null;

  const grouped = useMemo(
    () => GROUPS.map((g) => ({ ...g, pages: GUIDE.filter((p) => p.group === g.id) })),
    []
  );

  useEffect(() => {
    if (!page) return;
    document.title = `${page.title} · LedgerWatch guide`;
    // A link such as /docs/settings#payout-details lands on that heading.
    // The router does not scroll to a hash by itself, and headings carry ids
    // made from their text, so this does it. Anything else starts at the top.
    //
    // Pictures above the heading load lazily and have no reserved height, so
    // a single scroll lands correctly and is then pushed down as they arrive.
    // The scroll is repeated for a moment, and stops the instant the reader
    // scrolls for themselves.
    const target = hash ? document.getElementById(hash.slice(1)) : null;
    if (!target) {
      window.scrollTo(0, 0);
      return () => {
        document.title = "LedgerWatch: Automated receivables and market monitoring";
      };
    }
    let cancelled = false;
    const stop = () => {
      cancelled = true;
    };
    const jump = () => {
      if (!cancelled) target.scrollIntoView({ block: "start" });
    };
    jump();
    const timers = [250, 700, 1400, 2400].map((ms) => setTimeout(jump, ms));
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("keydown", stop);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
      document.title = "LedgerWatch: Automated receivables and market monitoring";
    };
  }, [page, hash]);

  if (!page) return <Navigate to="/docs" replace />;

  const prev = index > 0 ? GUIDE[index - 1] : null;
  const next = index < GUIDE.length - 1 ? GUIDE[index + 1] : null;
  const group = GROUPS.find((g) => g.id === page.group);

  return (
    <PublicShell wide>
      <div className="docs">
        <aside className="docs-side" aria-label="Guide sections">
          {grouped.map((g) => (
            <div className="docs-side-group" key={g.id}>
              <h2 className="docs-side-title">{g.label}</h2>
              {g.pages.map((p) => (
                <NavLink
                  key={p.slug}
                  to={p.slug === GUIDE[0].slug ? "/docs" : `/docs/${p.slug}`}
                  end
                  className={({ isActive }) => (isActive || p.slug === page.slug ? "active" : undefined)}
                >
                  {p.title}
                </NavLink>
              ))}
            </div>
          ))}
        </aside>

        <article className="docs-body">
          <select
            className="select docs-mobile-select"
            aria-label="Go to a guide page"
            value={page.slug}
            onChange={(e) => navigate(e.target.value === GUIDE[0].slug ? "/docs" : `/docs/${e.target.value}`)}
          >
            {grouped.map((g) => (
              <optgroup key={g.id} label={g.label}>
                {g.pages.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <p className="docs-crumb">
            <Link to="/docs">Guide</Link> / {group ? group.label : ""}
          </p>
          <h1>{page.title}</h1>
          {page.intro && <p className="docs-intro">{page.intro}</p>}

          <Blocks blocks={page.blocks} />

          <div className="docs-nav-bottom">
            {prev ? (
              <Link to={prev.slug === GUIDE[0].slug ? "/docs" : `/docs/${prev.slug}`}>
                <ArrowLeft size={15} /> {prev.title}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link to={`/docs/${next.slug}`}>
                {next.title} <ArrowRight size={15} />
              </Link>
            ) : (
              <span />
            )}
          </div>
        </article>
      </div>
    </PublicShell>
  );
}
