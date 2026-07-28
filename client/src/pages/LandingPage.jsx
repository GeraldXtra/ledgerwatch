import { BellRing, Bell, Check, LineChart, Receipt, ShieldCheck } from "lucide-react";
import LandingNav from "../components/landing/LandingNav";
import Hero from "../components/landing/Hero";
import ProblemStrip from "../components/landing/ProblemStrip";
import FeatureRow from "../components/landing/FeatureRow";
import { ReceivablesVisual, MarketVisual } from "../components/landing/FeatureVisuals";
import HowItWorks from "../components/landing/HowItWorks";
import TrustStrip from "../components/landing/TrustStrip";
import CtaBand from "../components/landing/CtaBand";
import LandingFooter from "../components/landing/LandingFooter";

export default function LandingPage() {
  return (
    <div className="landing">
      <LandingNav />
      <main>
        <Hero />
        <ProblemStrip />

        <div id="features">
          <FeatureRow
            eyebrow="Receivables"
            title="Every naira, tracked and chased."
            intro="Record what you sold on credit, take part-payments as they come, and let LedgerWatch do the awkward follow-up for you."
            bullets={[
              {
                icon: <Receipt size={16} />,
                title: "Debts and part-payments",
                body: "Log a sale, record payments as they arrive, and watch the balance fall to zero.",
              },
              {
                icon: <BellRing size={16} />,
                title: "Polite reminders, sent for you",
                body: "A warm message with your account details, ready to send on WhatsApp in one tap.",
              },
              {
                icon: <ShieldCheck size={16} />,
                title: "Know who actually pays",
                body: "Every customer gets a reliability score from their real payment history.",
              },
            ]}
            visual={<ReceivablesVisual />}
          />

          <FeatureRow
            band
            flip
            eyebrow="Market Watch"
            title="The market, watched for you."
            intro="Tell the agent what to watch. It follows live prices day and night and only interrupts you when something you care about happens."
            bullets={[
              {
                icon: <LineChart size={16} />,
                title: "Live prices and real charts",
                body: "Every coin with 24h moves, seven-day trends and full price history.",
              },
              {
                icon: <Bell size={16} />,
                title: "Alerts when your condition hits",
                body: "Set a drop, a rise or a price level. The agent explains why it fired.",
              },
              {
                icon: <Check size={16} />,
                title: "You approve every trade",
                body: "Trades run against a simulated portfolio. No real money is ever involved.",
              },
            ]}
            visual={<MarketVisual />}
          />
        </div>

        <HowItWorks />
        <TrustStrip />
        <CtaBand />
      </main>
      <LandingFooter />
    </div>
  );
}
