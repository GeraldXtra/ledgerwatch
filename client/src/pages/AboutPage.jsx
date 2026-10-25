import { Link } from "react-router-dom";
import PublicShell from "../components/PublicShell";
import usePageMeta from "../components/usePageMeta";
import { Blocks } from "../docs/Blocks";

const BLOCKS = [
  { type: "h2", text: "Who runs it" },
  {
    type: "p",
    text: "LedgerWatch is built and run by Eberechukwu Uchechukwu Gerald, in Nigeria. There is no team behind a curtain: when you write through the [Contact](/contact) page, the person who answers is the person who wrote the code.",
  },
  { type: "h2", text: "What it is for" },
  {
    type: "p",
    text: "It is for small businesses that sell on credit: distributors, contractors and suppliers who deliver first and get paid later. It keeps track of what each customer owes, sends polite reminders by email and WhatsApp, gives every invoice a payment page and a PDF, and marks the invoice paid when the money arrives. A second part, Market Watch, watches coin prices and raises an alert when a condition you set is met.",
  },
  { type: "h2", text: "How it treats your money" },
  {
    type: "ul",
    items: [
      "**Your wallet is yours.** It is created in your browser, and the keys never reach the server. Nobody at LedgerWatch can move your money, and nobody can recover it if you lose your recovery phrase.",
      "**Payments go straight to you.** A customer who pays in a stablecoin pays an address derived from your own wallet. Bank transfers go to your own account.",
      "**Nothing trades without you.** Market Watch suggests; every trade waits for you to confirm it.",
    ],
  },
  { type: "h2", text: "How it is paid for" },
  {
    type: "p",
    text: "LedgerWatch is free to use at the moment. [Pricing](/pricing) explains the costs that come from outside it, such as network fees, and the [terms](/terms) say what happens if that ever changes.",
  },
  { type: "h2", text: "Where to read more" },
  {
    type: "ul",
    items: [
      "[The guide](/docs), which explains every page and feature.",
      "[Safety](/docs/safety), which explains how your wallet and keys are protected.",
      "[The privacy policy](/privacy), which lists exactly what is stored and why.",
    ],
  },
];

export default function AboutPage() {
  usePageMeta({
    title: "About LedgerWatch",
    description:
      "LedgerWatch is built and run in Nigeria by Eberechukwu Uchechukwu Gerald, for small businesses that sell on credit. Your wallet stays yours.",
    path: "/about",
  });
  return (
    <PublicShell>
      <div className="article-page">
        <article className="docs-body">
          <p className="docs-crumb">
            <Link to="/">LedgerWatch</Link>
          </p>
          <h1>About LedgerWatch</h1>
          <p className="docs-intro">
            A tool that chases the money you are owed, closes the invoice when it arrives, and keeps your money in your
            own hands.
          </p>
          <Blocks blocks={BLOCKS} />
        </article>
      </div>
    </PublicShell>
  );
}
