import { useEffect, useState } from "react";
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
import { kpiNgn } from "./format";

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
      title="Ask about your ledger"
      subtitle="Ordinary questions, answered over your own figures. Who owes most, who never pays on time."
    >
      <div className="stack">
        <form onSubmit={ask} className="row wrap">
          <Input
            className="grow"
            placeholder="Try: who owes me the most?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            aria-label="Ask about your receivables"
          />
          <Button type="submit" variant="secondary" disabled={asking}>
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

  /**
   * The analytics live here rather than inside the overview panel, because the
   * folio at the top of the page states them and the folio belongs to the page.
   *
   * This is the change that retired the row of four boxed KPI cards. The same
   * request, the same numbers, stated once at the top in the figures rail
   * instead of twice: once in a box and once in a chart caption.
   */
  const [analytics, setAnalytics] = useState(null);
  const [analyticsError, setAnalyticsError] = useState("");

  useEffect(() => {
    let active = true;
    http
      .get("/api/receivables/analytics")
      .then(({ data }) => active && setAnalytics(data))
      .catch(
        (err) =>
          active &&
          setAnalyticsError(err?.response?.data?.error || "Could not load your figures")
      );
    return () => {
      active = false;
    };
  }, []);

  const overdue = analytics?.countByStatus?.overdue || 0;

  // Nothing is stated until it is known. An empty figures rail is honest; a rail
  // of zeroes while the request is still in flight is a wrong number.
  const figures = analytics
    ? [
        {
          label: "Outstanding",
          countTo: analytics.totalOutstanding,
          format: kpiNgn,
          mark: true,
          note: "across every open balance",
        },
        {
          label: "Overdue",
          value: String(overdue),
          tone: overdue > 0 ? "neg" : undefined,
          note: overdue === 1 ? "one account past due" : "accounts past due",
        },
        {
          label: "Collected",
          countTo: analytics.collectedThisMonth,
          format: kpiNgn,
          tone: analytics.collectedThisMonth > 0 ? "pos" : undefined,
          note: "so far this month",
        },
        {
          label: "Rate",
          countTo: analytics.collectionRate,
          format: (n) => `${Math.round(n)}%`,
          note: "of everything invoiced",
        },
      ]
    : undefined;

  return (
    <>
      <PageHeader
        title="Receivables"
        support="What you are owed, who owes it, and how long it has been waiting."
        figures={figures}
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
            <ReceivablesOverview data={analytics} error={analyticsError} />
            <AssistantCard />
          </>
        )}
        {tab === "debts" && <DebtsPanel />}
        {tab === "debtors" && <DebtorsView />}
      </div>
    </>
  );
}

// ToastProvider wraps the tab so Receivables and its children can raise toasts.
export default function ReceivablesPage() {
  return (
    <ToastProvider>
      <Receivables />
    </ToastProvider>
  );
}
