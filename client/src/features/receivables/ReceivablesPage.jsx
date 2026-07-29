import { useState } from "react";
import { BarChart3, Receipt, Sparkles, Users } from "lucide-react";
import http from "../../api/http";
import {
  Button,
  Card,
  Input,
  PageHeader,
  SkeletonLines,
  ToastProvider,
} from "../../components/ui";
import ReceivablesOverview from "./ReceivablesOverview";
import DebtsPanel from "./DebtsPanel";
import DebtorsView from "./DebtorsView";

const TABS = [
  { id: "overview", label: "Overview", icon: <BarChart3 size={15} /> },
  { id: "debts", label: "Debts", icon: <Receipt size={15} /> },
  { id: "debtors", label: "Debtors", icon: <Users size={15} /> },
];

function AssistantCard() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);

  async function ask(e) {
    e.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    setAnswer("");
    try {
      const { data } = await http.post("/api/ai/receivables-query", { question });
      setAnswer(data.answer);
    } catch (err) {
      setAnswer(err?.response?.data?.error || "Failed to answer");
    } finally {
      setAsking(false);
    }
  }

  return (
    <Card
      eyebrow="Assistant"
      title="Ask about your receivables"
      subtitle="Plain-language answers over your ledger — who owes most, who never pays on time."
      icon={<Sparkles size={17} />}
    >
      <div className="stack">
        <form onSubmit={ask} className="row wrap">
          <Input
            className="grow"
            placeholder="e.g. who owes me the most?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            aria-label="Ask about your receivables"
          />
          <Button type="submit" disabled={asking}>
            <Sparkles size={14} /> {asking ? "Thinking..." : "Ask"}
          </Button>
        </form>
        {asking && <SkeletonLines count={2} />}
        {answer && !asking && <p className="answer">{answer}</p>}
      </div>
    </Card>
  );
}

function Receivables() {
  const [tab, setTab] = useState("overview");

  return (
    <>
      <PageHeader
        title="Receivables"
        support="Track invoices, record part-payments, and see which clients actually pay on terms."
      />

      <div className="subtabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "subtab active" : "subtab"}
            onClick={() => setTab(t.id)}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div key={tab} className="stack subtab-panel">
        {tab === "overview" && (
          <>
            <ReceivablesOverview />
            <AssistantCard />
          </>
        )}
        {tab === "debts" && <DebtsPanel />}
        {tab === "debtors" && <DebtorsView />}
      </div>
    </>
  );
}

// ToastProvider wraps the tab so Receivables (and its children) can raise toasts.
export default function ReceivablesPage() {
  return (
    <ToastProvider>
      <Receivables />
    </ToastProvider>
  );
}
