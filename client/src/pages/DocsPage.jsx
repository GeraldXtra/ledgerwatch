import { useEffect, useMemo } from "react";
import { Link, Navigate, NavLink, useNavigate, useParams } from "react-router-dom";
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
    window.scrollTo(0, 0);
    return () => {
      document.title = "LedgerWatch: Automated receivables and market monitoring";
    };
  }, [page]);

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
              <p className="docs-side-title">{g.label}</p>
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
