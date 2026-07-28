import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import Reveal from "./Reveal";

export default function CtaBand() {
  return (
    <section className="landing-section">
      <div className="landing-inner">
        <Reveal className="cta-band">
          <h2 className="h1-landing">Ready to stop chasing?</h2>
          <p className="section-sub">
            Record your first debt in under a minute. The demo account is already full of
            data if you would rather look around first.
          </p>
          <div className="row wrap" style={{ justifyContent: "center" }}>
            <Link to="/login" className="btn btn-primary btn-lg">
              Get started <ArrowRight size={16} />
            </Link>
            <Link to="/login" className="btn btn-lg">
              Sign in
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
