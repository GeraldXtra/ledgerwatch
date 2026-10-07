import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
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

const VIEWS = ["overview", "debts", "debtors"];

const PARENT = {
  debt: "debts",
  record: "debts",
  edit: "debts",
  reminder: "debts",
  crypto: "debts",
  sweep: "debts",
  debtor: "debtors",
  statement: "debtors",
};

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
        <form onSubmit={ask} className="ask-row">
          <Input
            className="grow"
            placeholder="Try: who owes me the most?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            aria-label="Ask about your receivables"
          />
          <Button type="submit" variant="secondary" disabled={asking}>
            {asking ? "Thinking..." : "Ask"}
          </Button>
        </form>
        {asking && <SkeletonLines count={2} />}
        {answer && !asking && <p className="answer">{answer}</p>}
      </div>
    </Card>
  );
}

function Receivables() {
  const [params] = useSearchParams();
  const wanted = params.get("view");
  const lastTab = useRef("overview");
  const tab = VIEWS.includes(wanted)
    ? wanted
    : PARENT[wanted] || (wanted ? lastTab.current : "overview");
  lastTab.current = tab;

  const [analytics, setAnalytics] = useState(null);
  const [analyticsError, setAnalyticsError] = useState("");

  const [analyticsKey, setAnalyticsKey] = useState(0);
  const refreshAnalytics = useCallback(() => setAnalyticsKey((k) => k + 1), []);

  useEffect(() => {
    let active = true;
    http
      .get("/api/receivables/analytics")
      .then(({ data }) => {
        if (!active) return;
        setAnalytics(data);
        setAnalyticsError("");
      })
      .catch(
        (err) =>
          active &&
          setAnalyticsError(err?.response?.data?.error || "Could not load your figures")
      );
    return () => {
      active = false;
    };
  }, [analyticsKey, tab]);

  const overdue = analytics?.countByStatus?.overdue || 0;

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
      {tab === "overview" && (
        <PageHeader
          title="Receivables"
          support="What you are owed, who owes it, and how long it has been waiting."
          figures={figures}
        />
      )}

      <div key={tab} className="page-stack subtab-panel">
        {tab === "overview" && (
          <>
            <ReceivablesOverview data={analytics} error={analyticsError} />
            <AssistantCard />
          </>
        )}
        {tab === "debts" && <DebtsPanel onLedgerChanged={refreshAnalytics} />}
        {tab === "debtors" && <DebtorsView />}
      </div>
    </>
  );
}

export default function ReceivablesPage() {
  return (
    <ToastProvider>
      <Receivables />
    </ToastProvider>
  );
}
