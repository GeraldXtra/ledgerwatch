import { useEffect } from "react";
import PublicShell from "../components/PublicShell";
import { Blocks } from "../docs/Blocks";
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

  return (
    <PublicShell>
      <article className="legal docs-body">
        <h1>{doc.title}</h1>
        <p className="legal-meta">{doc.meta}</p>
        <Blocks blocks={doc.blocks} />
      </article>
    </PublicShell>
  );
}
