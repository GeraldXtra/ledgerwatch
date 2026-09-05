import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bell,
  BookOpen,
  Coins,
  KeyRound,
  LineChart,
  Receipt,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import LogoMark from "../components/LogoMark";

/**
 * THE FRONT PAGE
 *
 * One screen says what the product does, one row of three says what is in
 * it, three steps say how to start, and a plain footer. It replaced a five
 * section broadsheet with a parallax ledger and numbered columns, which
 * users found too much. A visitor has a few seconds to work out whether
 * this is for them; short and clear serves them better than atmosphere.
 */

const ROWS = [
  { who: "Dangote Cement", amount: "85,000", state: "Overdue 6 days", tone: "neg" },
  { who: "Zenith Trading", amount: "42,500", state: "Reminder sent", tone: "warn" },
  { who: "Emeka Obi Ltd", amount: "30,000", state: "Part paid", tone: "warn" },
  { who: "Chidi Okafor", amount: "18,000", state: "Due Friday", tone: "" },
];

function LedgerPanel() {
  return (
    <div className="site-panel" aria-hidden="true">
      <div className="site-panel-head">
        <span>Outstanding</span>
        <span className="site-panel-meta">4 open</span>
      </div>
      {ROWS.map((r) => (
        <div className="site-panel-row" key={r.who}>
          <span className="site-panel-who">{r.who}</span>
          <span className={`pill ${r.tone}`}>{r.state}</span>
          <span className="site-panel-amt">{r.amount}</span>
        </div>
      ))}
      <div className="site-panel-foot">
        <span className="site-panel-meta">Total owed to you</span>
        <span>NGN 175,500</span>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="site">
      <header className="site-nav">
        <div className="site-nav-inner">
          <Link to="/" className="brand">
            <LogoMark size={30} />
            <span className="brand-name">
              Ledger<em>Watch</em>
            </span>
          </Link>
          <nav className="site-nav-links">
            <a className="site-nav-link hide-sm" href="#features">
              Features
            </a>
            <Link className="site-nav-link hide-sm" to="/docs">
              Guide
            </Link>
            <Link className="site-nav-link hide-sm" to="/contact">
              Contact
            </Link>
            <Link className="site-nav-link" to="/login">
              Sign in
            </Link>
            <Link className="btn btn-primary" to="/login">
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="site-wrap site-hero">
          <div>
            <h1>Get paid what you are owed, without chasing anyone yourself.</h1>
            <p className="site-lead">
              LedgerWatch keeps track of who owes you, writes and sends the reminder, and closes
              the invoice the moment the money arrives. It also watches coin prices for you and
              only interrupts when something you asked about happens.
            </p>
            <div className="site-cta">
              <Link to="/login" className="btn btn-primary btn-lg">
                Create a free account <ArrowRight size={16} />
              </Link>
              <Link to="/docs" className="btn btn-lg">
                <BookOpen size={16} /> Read the guide
              </Link>
            </div>
            <p className="site-note">
              <ShieldCheck size={15} />
              Your wallet keys are created and kept in your browser. Nothing is signed without
              you.
            </p>
          </div>
          <LedgerPanel />
        </section>

        <section className="site-section" id="features">
          <div className="site-wrap">
            <div className="site-section-head">
              <h2>What is inside</h2>
              <p>
                Four sections, each doing one job. Use the ones you need and ignore the rest.
              </p>
            </div>
            <div className="site-grid">
              <div className="site-feature">
                <span className="site-feature-icon">
                  <Receipt size={18} />
                </span>
                <h3>Receivables</h3>
                <p>
                  Record what you sold on credit, take part payments as they arrive, and let the
                  reminders go out on a schedule you set, over WhatsApp or email, with your bank
                  details already in them.
                </p>
                <Link to="/docs/receivables" className="site-feature-link">
                  How receivables work
                </Link>
              </div>
              <div className="site-feature">
                <span className="site-feature-icon">
                  <Coins size={18} />
                </span>
                <h3>Crypto payments</h3>
                <p>
                  Give each invoice its own payment address. When the stablecoin arrives and
                  confirms, the invoice is settled automatically and the payer gets a receipt.
                </p>
                <Link to="/docs/crypto-payments" className="site-feature-link">
                  How crypto payments work
                </Link>
              </div>
              <div className="site-feature">
                <span className="site-feature-icon">
                  <LineChart size={18} />
                </span>
                <h3>Market Watch</h3>
                <p>
                  Watch coin prices against conditions you set. When one is met you get an alert
                  with an explanation, and you decide whether to buy, sell or ignore it.
                </p>
                <Link to="/docs/market-watch" className="site-feature-link">
                  How Market Watch works
                </Link>
              </div>
              <div className="site-feature">
                <span className="site-feature-icon">
                  <Wallet size={18} />
                </span>
                <h3>Wallet</h3>
                <p>
                  A wallet for Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche
                  and Bitcoin, created and encrypted in your browser and unlocked only by your
                  password.
                </p>
                <Link to="/docs/wallet" className="site-feature-link">
                  How the wallet works
                </Link>
              </div>
              <div className="site-feature">
                <span className="site-feature-icon">
                  <Bell size={18} />
                </span>
                <h3>Notifications</h3>
                <p>
                  Reminders ready to send, payments received and price alerts reach you as push
                  notifications on your phone or computer, with the action one tap away.
                </p>
                <Link to="/docs/settings" className="site-feature-link">
                  Setting up notifications
                </Link>
              </div>
              <div className="site-feature">
                <span className="site-feature-icon">
                  <KeyRound size={18} />
                </span>
                <h3>Security</h3>
                <p>
                  Email verification, sign in with Google, password reset by emailed code, and a
                  wallet the server can never spend from. Every transaction needs your password.
                </p>
                <Link to="/docs/safety" className="site-feature-link">
                  Keeping your money safe
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="site-section">
          <div className="site-wrap">
            <div className="site-section-head">
              <h2>Getting started takes a few minutes</h2>
            </div>
            <div className="site-steps">
              <div className="site-step">
                <span className="site-step-no">1</span>
                <h3>Create an account</h3>
                <p>
                  Sign up with your email, or with Google. Add your bank details once so every
                  reminder carries them.
                </p>
              </div>
              <div className="site-step">
                <span className="site-step-no">2</span>
                <h3>Add who owes you</h3>
                <p>
                  A name, an amount and a due date. Choose how often to remind, and whether
                  reminders send themselves or wait for you.
                </p>
              </div>
              <div className="site-step">
                <span className="site-step-no">3</span>
                <h3>Let it run</h3>
                <p>
                  LedgerWatch chases, records what comes in, closes what is settled, and tells you
                  when something needs a decision.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="site-band">
          <div className="site-wrap">
            <h2>Ready when you are</h2>
            <p>
              Create an account, add your first debtor, and see whether it earns its place. The
              guide explains every page if you would rather read first.
            </p>
            <div className="site-cta">
              <Link to="/login" className="btn btn-lg">
                Create a free account <ArrowRight size={16} />
              </Link>
              <Link to="/docs" className="btn btn-lg">
                Read the guide
              </Link>
            </div>
          </div>
        </section>
      </main>

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
