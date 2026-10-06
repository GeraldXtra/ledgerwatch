import { useEffect } from "react";
import PublicShell from "../components/PublicShell";
import { Blocks, slugify } from "../docs/Blocks";
import { PRIVACY, TERMS } from "../docs/legal";

/**
 * The privacy policy and the terms. One component, two documents, both kept
 * as data in docs/legal.js so they read as the letters they are and can be
 * changed without touching a component.
 */
export default function LegalPage({ which }) {
  const doc = which === "terms" ? TERMS : PRIVACY;

  useEffect(() => {
    document.title = `${doc.title} · LedgerWatch`;
    window.scrollTo(0, 0);
    return () => {
      document.title = "LedgerWatch: Automated receivables and market monitoring";
    };
  }, [doc]);

  const headings = doc.blocks.filter((b) => b.type === "h2");
  const links = headings.map((h) => (
    <a key={h.text} href={`#${slugify(h.text)}`}>
      {h.text}
    </a>
  ));

  return (
    <PublicShell>
      <div className="legal-layout">
        <nav className="legal-toc">
          <p>On this page</p>
          {links}
        </nav>
        <article className="legal docs-body">
          <h1>{doc.title}</h1>
          <p className="legal-meta">{doc.meta}</p>
          <details className="toc-m">
            <summary>On this page</summary>
            <nav>{links}</nav>
          </details>
          <Blocks blocks={doc.blocks} />
        </article>
      </div>
    </PublicShell>
  );
}
