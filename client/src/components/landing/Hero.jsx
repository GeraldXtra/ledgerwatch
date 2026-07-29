import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import DashboardMockup from "./DashboardMockup";

const MAX_DRIFT = 20; // px

export default function Hero() {
  const visualRef = useRef(null);

  // Subtle parallax drift on the mockup — transform only, capped, rAF-throttled.
  useEffect(() => {
    const el = visualRef.current;
    if (!el) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const rect = el.getBoundingClientRect();
        const progress = rect.top / window.innerHeight; // ~1 at bottom, ~0 near top
        const drift = Math.max(-MAX_DRIFT, Math.min(MAX_DRIFT, (0.5 - progress) * MAX_DRIFT * 2));
        el.style.setProperty("--parallax", `${drift.toFixed(1)}px`);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section className="landing-hero">
      <div className="landing-inner hero-grid-landing">
        <div className="hero-copy">
          <span className="overline accent hero-in" style={{ animationDelay: "0ms" }}>
            Built for companies carrying receivables
          </span>
          <h1 className="display hero-in" style={{ animationDelay: "70ms" }}>
            Collect what you&rsquo;re owed. Watch the markets you can&rsquo;t.
          </h1>
          <p className="lead hero-in" style={{ animationDelay: "140ms" }}>
            LedgerWatch chases every outstanding invoice for you and monitors the market around
            the clock, so nothing slips while you run the business.
          </p>
          <div className="row wrap hero-in" style={{ animationDelay: "210ms" }}>
            <Link to="/login" className="btn btn-primary btn-lg">
              Get started <ArrowRight size={16} />
            </Link>
            <Link to="/login" className="btn btn-lg">
              Sign in
            </Link>
          </div>
          <p className="hero-note hero-in" style={{ animationDelay: "280ms" }}>
            No card required. Try the live demo in one click.
          </p>
        </div>

        <div ref={visualRef} className="hero-visual hero-in" style={{ animationDelay: "180ms" }}>
          <DashboardMockup />
        </div>
      </div>
    </section>
  );
}
