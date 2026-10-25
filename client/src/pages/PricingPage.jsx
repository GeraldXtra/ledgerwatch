import { Link } from "react-router-dom";
import PublicShell from "../components/PublicShell";
import usePageMeta from "../components/usePageMeta";
import { Blocks } from "../docs/Blocks";

const BLOCKS = [
  { type: "h2", text: "What LedgerWatch costs" },
  {
    type: "p",
    text: "Nothing. Every part of LedgerWatch is free to use at the moment: invoices, reminders, payment pages, crypto payment addresses, the wallet, Market Watch and notifications. There is no trial period and no card to enter.",
  },
  {
    type: "callout",
    title: "If that changes",
    text: "If a fee is ever introduced for any part of LedgerWatch, you will be told clearly and in advance, and nothing you already have will be held back for it. The [terms](/terms) say the same.",
  },
  { type: "h2", text: "Costs that come from outside LedgerWatch" },
  {
    type: "p",
    text: "Some things LedgerWatch does for you involve other companies or networks, and they set their own charges. None of them is paid to LedgerWatch.",
  },
  {
    type: "table",
    head: ["When you", "Who charges", "What it costs"],
    rows: [
      ["Send or swap crypto", "The blockchain network", "A network fee, paid in that network's own coin. The wallet shows it before you confirm."],
      ["Swap one coin for another", "The exchange pool", "A pool fee, usually between 0.01% and 1% of the trade, shown in the quote."],
      ["Buy or sell crypto with naira", "Transak, the payment provider", "Transak's own fee, shown on its page before you pay."],
      ["Send WhatsApp reminders automatically", "Meta or Twilio", "Their charge per business message. Sending from your own WhatsApp with one tap is free."],
      ["Receive a bank transfer", "Your bank", "Whatever your bank already charges you."],
    ],
  },
  { type: "h2", text: "Questions" },
  {
    type: "p",
    text: "Write through the [Contact](/contact) page and you will get an answer from the person who runs LedgerWatch.",
  },
];

export default function PricingPage() {
  usePageMeta({
    title: "Pricing · LedgerWatch",
    description:
      "LedgerWatch is free to use. Network fees, exchange fees, naira payment provider fees and WhatsApp messaging charges are set by those providers.",
    path: "/pricing",
  });
  return (
    <PublicShell>
      <div className="article-page">
        <article className="docs-body">
          <p className="docs-crumb">
            <Link to="/">LedgerWatch</Link>
          </p>
          <h1>Pricing</h1>
          <p className="docs-intro">LedgerWatch is free. Here is everything that is, and the few things that are not.</p>
          <Blocks blocks={BLOCKS} />
        </article>
      </div>
    </PublicShell>
  );
}
