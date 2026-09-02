import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bell,
  BellRing,
  KeyRound,
  LineChart,
  Receipt,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import LogoMark from "../components/LogoMark";
import Reveal from "../components/landing/Reveal";

/**
 * THE LANDING PAGE, SET AS A BROADSHEET
 *
 * The previous one was the shape every template ships with: a floating browser
 * window with three dots, an eyebrow over a bold sans headline, and three
 * rounded cards each with a circle icon, on alternating grey bands.
 *
 * There was nothing wrong with any of it, which is exactly the problem. It said
 * nothing about what this product is, and a visitor has about four seconds to
 * work that out.
 *
 * So this page is a printed page. A masthead, a dated strap, a headline in the
 * serif, and instead of a fake screenshot, an actual ruled ledger with real
 * looking debtors and a running total. That single object does more explaining
 * than the three paragraphs it replaced, because anybody who has chased an
 * invoice recognises it immediately.
 *
 * Sections are separated by rules rather than by alternating grey. Columns are
 * divided by hairlines and numbered, rather than boxed and iconed.
 */

// The strap line. Says what the product IS rather than which networks are
// switched on, because the second kind of claim goes stale silently: this line
// read "running on test networks" right up until mainnet was enabled.
const EDITION = "Receivables and market watch, on a wallet only you hold";

/* The hero object. A ledger, ruled, with a running total struck in brass. */
function LedgerSheet() {
  const ref = useRef(null);

  // A very small parallax. Transform only, capped at 18px, and skipped entirely
  // when the visitor has asked for less motion.
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const rect = el.getBoundingClientRect();
        const progress = rect.top / window.innerHeight;
        const drift = Math.max(-18, Math.min(18, (0.5 - progress) * 36));
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

  const rows = [
    { who: "Dangote Cement", amount: "85,000", state: "Overdue 6 days", tone: "neg" },
    { who: "Zenith Trading", amount: "42,500", state: "Reminder sent", tone: "warn" },
    { who: "Emeka Obi Ltd", amount: "30,000", state: "Part paid", tone: "warn" },
    { who: "Chidi Okafor", amount: "18,000", state: "Due Friday", tone: "" },
  ];

  return (
    <div className="ed-sheet" ref={ref}>
      <div className="ed-sheet-head">
        <span className="ed-sheet-title">Outstanding</span>
        <span className="ed-sheet-meta">Four accounts open</span>
      </div>
      {rows.map((r) => (
        <div className="ed-sheet-row" key={r.who}>
          <span className="ed-sheet-who">{r.who}</span>
          <span className={`pill ${r.tone}`}>{r.state}</span>
          <span className="ed-sheet-amt">{r.amount}</span>
        </div>
      ))}
      <div className="ed-sheet-foot">
        <span className="ed-sheet-meta">Total owed to you</span>
        <span className="ed-sheet-total">NGN 175,500</span>
      </div>
    </div>
  );
}

/* The reminder the agent writes. Shown as a note, because that is what it is. */
function ReminderNote() {
  return (
    <div className="ed-sheet">
      <div className="ed-sheet-head">
        <span className="ed-sheet-title">Drafted for you</span>
        <span className="ed-sheet-meta">Ready to send</span>
      </div>
      <div className="ed-note-body">
        <p>Good morning Mrs Okafor,</p>
        <p>
          A gentle reminder that <strong>NGN 30,000</strong> is still open on invoice 0114, and it
          was due on the 12th. Thank you for the <strong>NGN 20,000</strong> you sent last week,
          which is already on the account.
        </p>
        <p className="ed-note-bank">
          Zenith Bank &middot; 1042 8871 03 &middot; Gerald Trading Ltd
        </p>
      </div>
      <div className="ed-sheet-foot">
        <span className="ed-sheet-meta">Sent on WhatsApp and email</span>
        <span className="pill pos">Delivered</span>
      </div>
    </div>
  );
}

/* An alert waiting on a person. The whole product argument in one object. */
function AlertNote() {
  return (
    <div className="ed-sheet">
      <div className="ed-sheet-head">
        <span className="ed-sheet-title">Bitcoin</span>
        <span className="ed-sheet-meta">Condition met at 04:12</span>
      </div>
      <div className="ed-note-body">
        <p className="ed-note-figure">
          <span>USD 61,480</span>
          <span className="neg">down 5.2 percent</span>
        </p>
        <p>
          Your watch was set for a fall of five percent. It has fallen five point two since
          yesterday, mostly overnight while nothing else moved.
        </p>
      </div>
      <div className="ed-sheet-foot ed-note-actions">
        <span className="ed-sheet-meta">The agent suggests buying</span>
        <span className="row">
          <span className="btn btn-primary btn-sm lw">Buy</span>
          <span className="btn btn-sm lw">Sell</span>
          <span className="btn btn-ghost btn-sm lw">Ignore</span>
        </span>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="ed">
      <header className="ed-nav">
        <div className="ed-wrap">
          <div className="ed-nav-inner">
            <Link to="/" className="lw-brand">
              <LogoMark size={32} />
              <span className="lw-brand-name">
                Ledger<em>Watch</em>
              </span>
            </Link>
            <nav className="ed-nav-links">
              <a className="ed-nav-link hide-sm" href="#work">
                What it does
              </a>
              <a className="ed-nav-link hide-sm" href="#how">
                How it works
              </a>
              <Link className="ed-nav-link" to="/login">
                Sign in
              </Link>
              <Link className="btn btn-primary lw" to="/login">
                Get started <ArrowRight size={15} />
              </Link>
            </nav>
          </div>
          <hr className="lw-rule" />
          <div className="ed-strap">
            <span>Built in Lagos for businesses that sell on credit</span>
            <span className="hide-sm">{EDITION}</span>
          </div>
        </div>
      </header>

      <main>
        {/* ---------------------------------------------------------- hero -- */}
        <section className="ed-wrap ed-hero">
          <div className="ed-rise">
            <span className="ed-kicker">The money you have already earned</span>
            <h1 className="ed-headline">
              Somebody has to chase the invoice. <span className="mark">It should not be you.</span>
            </h1>
            <p className="ed-lead">
              LedgerWatch keeps the book, writes the awkward message, sends it, and stops the moment
              the money lands. It watches your coin prices through the night as well, and wakes you
              only when something you asked about actually happens.
            </p>
            <div className="ed-cta">
              <Link to="/login" className="btn btn-primary btn-lg lw">
                Open the ledger <ArrowRight size={16} />
              </Link>
              <Link to="/login" className="btn btn-lg lw">
                Sign in
              </Link>
            </div>
            <p className="ed-note">
              <ShieldCheck size={15} />
              Your keys are made and kept in your browser, and nothing is signed without you.
            </p>
          </div>

          <div className="ed-rise" style={{ animationDelay: "120ms" }}>
            <LedgerSheet />
          </div>
        </section>

        {/* ------------------------------------------------------- problem -- */}
        <section className="ed-section ed-wrap">
          <Reveal className="ed-section-head">
            <span className="ed-kicker">Why the money sits there</span>
            <h2 className="ed-section-title">
              It is almost never that the client refused to pay.
            </h2>
            <p className="ed-section-lead">
              It is that following it up is nobody's favourite job, so it slides to tomorrow. Enough
              tomorrows and it becomes a number in a spreadsheet that everybody has stopped looking
              at.
            </p>
          </Reveal>

          <Reveal className="ed-cols">
            <div className="ed-col">
              <span className="ed-col-no">One</span>
              <h3>The work finished weeks ago</h3>
              <p>
                The invoice went out, the job is done, and the only thing standing between you and
                the money is a message nobody wants to write.
              </p>
            </div>
            <div className="ed-col">
              <span className="ed-col-no">Two</span>
              <h3>Asking feels rude</h3>
              <p>
                So it gets postponed politely, and then quietly, and then not at all. The longer a
                balance sits, the less likely it is to ever arrive.
              </p>
            </div>
            <div className="ed-col">
              <span className="ed-col-no">Three</span>
              <h3>Nobody is counting</h3>
              <p>
                Part payments land, the balance shifts, and unless somebody keeps the book properly
                you never quite know who is behind and by how much.
              </p>
            </div>
          </Reveal>
        </section>

        {/* ---------------------------------------------------- receivables -- */}
        <section className="ed-section ed-wrap" id="work">
          <div className="ed-spread">
            <Reveal>
              <span className="ed-kicker">Receivables</span>
              <h2 className="ed-section-title">It writes the message you keep putting off.</h2>
              <p className="ed-section-lead">
                Record what you sold on credit. Take part payments as they arrive. LedgerWatch does
                the following up, in your voice, with your account details already in it.
              </p>
              <ul className="ed-points">
                <li>
                  <Receipt size={16} />
                  <div>
                    <strong>The book keeps itself</strong>
                    <span>
                      Log a sale, record what comes in, and watch the balance fall. The status
                      follows the money rather than somebody remembering to change it.
                    </span>
                  </div>
                </li>
                <li>
                  <BellRing size={16} />
                  <div>
                    <strong>Reminders that sound like a person</strong>
                    <span>
                      Warm, specific, and aware of what has already been paid. Sent on WhatsApp or
                      email, and cancelled the instant the invoice settles.
                    </span>
                  </div>
                </li>
                <li>
                  <ShieldCheck size={16} />
                  <div>
                    <strong>You learn who actually pays</strong>
                    <span>
                      Every customer earns a reliability score from their real history, which is the
                      thing worth knowing next time somebody asks you for credit.
                    </span>
                  </div>
                </li>
              </ul>
            </Reveal>
            <Reveal className="ed-spread-visual" delay={90}>
              <ReminderNote />
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------------- paid -- */}
        <section className="ed-section ed-wrap">
          <div className="ed-spread flip">
            <Reveal>
              <span className="ed-kicker">Getting paid</span>
              <h2 className="ed-section-title">
                Every invoice gets an address of its very own.
              </h2>
              <p className="ed-section-lead">
                This looks like a payments feature. It is really an accounting one. Because that
                address belongs to one invoice and nothing else, money arriving there is proof of
                who paid. There is no reference to quote and nothing to match up by hand.
              </p>
              <p className="ed-section-lead">
                LedgerWatch watches the chain, waits for the network to properly confirm it,
                converts at the rate the payer was quoted, and closes the invoice itself. If it is a
                part payment it records the part and carries on waiting for the rest.
              </p>
            </Reveal>
            <Reveal className="ed-spread-visual" delay={90}>
              <div className="ed-sheet">
                <div className="ed-sheet-head">
                  <span className="ed-sheet-title">Invoice 0114</span>
                  <span className="ed-sheet-meta">Base Sepolia</span>
                </div>
                <div className="ed-note-body">
                  <span className="ed-kicker" style={{ marginBottom: 8 }}>
                    Send exactly
                  </span>
                  <p className="ed-note-figure">
                    <span>18.75 USDC</span>
                  </p>
                  <p className="ed-addr num">0x7a3f 9c2e 44b1 08de 6f5a 1c90 3b7d</p>
                  <p>
                    On this network only. The agent is watching this address and will settle the
                    invoice the moment it confirms.
                  </p>
                </div>
                <div className="ed-sheet-foot">
                  <span className="ed-sheet-meta">Waiting for payment</span>
                  <span className="pill warn">Watching</span>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* -------------------------------------------------------- market -- */}
        <section className="ed-section ed-wrap">
          <div className="ed-spread">
            <Reveal>
              <span className="ed-kicker">Market Watch</span>
              <h2 className="ed-section-title">It watches while you sleep, then asks first.</h2>
              <p className="ed-section-lead">
                Tell the agent what matters in ordinary words. It follows live prices day and night
                and interrupts you only when the thing you described actually happens.
              </p>
              <ul className="ed-points">
                <li>
                  <LineChart size={16} />
                  <div>
                    <strong>Real prices and real charts</strong>
                    <span>
                      Every coin with its daily move, its week, and its full history. No sample data
                      anywhere.
                    </span>
                  </div>
                </li>
                <li>
                  <Bell size={16} />
                  <div>
                    <strong>It explains itself</strong>
                    <span>
                      An alert says what moved, by how much, and why it thinks you should care.
                      Never just a number appearing on a screen.
                    </span>
                  </div>
                </li>
                <li>
                  <KeyRound size={16} />
                  <div>
                    <strong>Then it stops</strong>
                    <span>
                      Buy, sell or ignore. The agent recommends and you decide the side and the
                      size. Nothing executes until you say so.
                    </span>
                  </div>
                </li>
              </ul>
            </Reveal>
            <Reveal className="ed-spread-visual" delay={90}>
              <AlertNote />
            </Reveal>
          </div>
        </section>

        {/* --------------------------------------------------------- trust -- */}
        <section className="ed-section tint">
          <div className="ed-wrap">
            <Reveal className="ed-section-head">
              <span className="ed-kicker">The wallet underneath</span>
              <h2 className="ed-section-title">Your keys never leave your browser.</h2>
              <p className="ed-section-lead">
                Both agents sit on a wallet that nobody else holds. It is made on your device,
                encrypted on your device, and every transaction is signed with a password you type
                at that moment.
              </p>
            </Reveal>

            <Reveal className="ed-cols">
              <div className="ed-col">
                <span className="ed-col-no">
                  <Wallet size={16} />
                </span>
                <h3>Made where you are</h3>
                <p>
                  The key is generated in the page and encrypted before it is stored. Our server
                  only ever learns the public address, which is the part meant to be public.
                </p>
              </div>
              <div className="ed-col">
                <span className="ed-col-no">
                  <KeyRound size={16} />
                </span>
                <h3>Signed by you, every time</h3>
                <p>
                  There is no path in this software that can sign anything on your behalf. The
                  agent can fill a form in. It cannot approve one.
                </p>
              </div>
              <div className="ed-col">
                <span className="ed-col-no">
                  <ShieldCheck size={16} />
                </span>
                <h3>The last word is yours</h3>
                <p>
                  Test networks sit beside the real ones, and moving to a real one asks you to
                  confirm it in writing. Whichever you are on, nothing leaves this browser without
                  the password you type at that moment.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ----------------------------------------------------------- how -- */}
        <section className="ed-section ed-wrap" id="how">
          <Reveal className="ed-section-head">
            <span className="ed-kicker">How it works</span>
            <h2 className="ed-section-title">Three steps, and then it runs itself.</h2>
          </Reveal>

          <Reveal className="ed-cols">
            <div className="ed-col">
              <span className="ed-col-no">Step one</span>
              <h3>Write down who owes you</h3>
              <p>
                Name, amount, and when it was due. That is the whole setup. Import the ones you are
                already chasing and start from where you are.
              </p>
            </div>
            <div className="ed-col">
              <span className="ed-col-no">Step two</span>
              <h3>Say how you want it chased</h3>
              <p>
                Every few days, once a week, or only when you press send. Add your bank details once
                and every message carries them.
              </p>
            </div>
            <div className="ed-col">
              <span className="ed-col-no">Step three</span>
              <h3>Get on with your work</h3>
              <p>
                The agent chases, records what arrives, closes what is settled, and tells you when
                something needs a human. Which is rarely.
              </p>
            </div>
          </Reveal>
        </section>

        {/* ---------------------------------------------------------- band -- */}
        <section className="ed-band">
          <div className="ed-wrap">
            <h2>The work is done. The invoice is out. Let something else do the asking.</h2>
            <p>
              Open an account and put your first debtor in. It takes about a minute, and you will
              know within a day whether it is worth keeping.
            </p>
            <div className="ed-cta">
              <Link to="/login" className="btn btn-brass btn-lg lw">
                Open the ledger <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="ed-wrap ed-foot">
        <span>
          LedgerWatch, by Eberechukwu Uchechukwu Gerald. All rights reserved.
        </span>
        <span>Your keys are yours. Every transaction is signed by you, on your own device.</span>
      </footer>
    </div>
  );
}
