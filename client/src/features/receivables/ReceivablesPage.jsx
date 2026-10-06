import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Sparkles } from "lucide-react";
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
  const [params] = useSearchParams();
  const wanted = params.get("view");
  const tab = VIEWS.includes(wanted) ? wanted : "overview";

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

  /**
   * WHY THIS IS KEYED RATHER THAN FETCHED ONCE.
   *
   * The effect below had an empty dependency array, so the four figures were
   * read at mount and never again. Recording a payment in the tab underneath
   * left "Outstanding" and "Collected" showing the figures from before it, and
   * switching tabs did not help either — only a full page reload corrected
   * them. The intent quoted above was that these numbers could never disagree
   * between two places, and they were instead disagreeing with the invoice list
   * on the same screen, immediately after the action that changed them.
   *
   * `analyticsKey` is bumped by the ledger below whenever it changes something
   * that moves money, and by a tab change, so the rail restates itself.
   */
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
      {tab === "overview" && (
        <PageHeader
          title="Receivables"
          support="What you are owed, who owes it, and how long it has been waiting."
          figures={figures}
        />
      )}

      <div key={tab} className={tab === "overview" ? "stack subtab-panel" : "subtab-panel ws-view"}>
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

// ToastProvider wraps the tab so Receivables and its children can raise toasts.
export default function ReceivablesPage() {
  return (
    <ToastProvider>
      <Receivables />
    </ToastProvider>
  );
}
