import { AlertCircle } from "lucide-react";
import { Card, SkeletonBlock } from "../../components/ui";
/**
 * THE CHARTS ARE SPLIT OUT. (LW-046, BUILD_PLAN P7-3.)
 *
 * These two are the only thing pulling recharts into the main bundle, and
 * recharts is the single largest dependency left in it. Receivables is the app's
 * default route, so the page itself must stay static — but the charts sit below
 * the figures, are not what anybody opens the page for, and render from data
 * that arrives over the network anyway. Deferring them takes recharts out of the
 * download every visitor to the front page pays for.
 */
import { Suspense, lazy } from "react";

const OwedCollectedChart = lazy(() => import("./OwedCollectedChart"));
const AgingChart = lazy(() => import("./AgingChart"));

/**
 * A plain block at the chart's own height, so the figures above it do not jump
 * when the chunk lands. An empty fallback would reflow the page.
 */
function ChartPlaceholder() {
  return <div className="chart-placeholder" aria-hidden="true" />;
}

/**
 * The two charts: six months of invoiced against collected, and how overdue the
 * unpaid money is.
 *
 * The KPI row that used to sit above these moved into the page folio, so the
 * four headline figures are stated once at the top of the page rather than in a
 * row of boxes here. `data` now arrives as a prop from ReceivablesPage, which
 * owns the request, so the same numbers can never disagree between the two
 * places they appear.
 *
 * An error is rendered as an error. It is never allowed to look like an empty
 * ledger, because "you are owed nothing" and "we could not ask" are different
 * claims about the world and only one of them is good news.
 */
export default function ReceivablesOverview({ data, error }) {
  if (error) {
    return (
      <Card title="Your figures">
        <p className="error-text" style={{ margin: 0 }}>
          {error}. This is a connection problem rather than an empty ledger, so nothing has been
          lost. Reload the page to try again.
        </p>
      </Card>
    );
  }

  if (!data) {
    return (
      <div className="grid2">
        <SkeletonBlock height={300} />
        <SkeletonBlock height={300} />
      </div>
    );
  }

  const overdue = data.countByStatus?.overdue || 0;

  return (
    <div className="grid2 overview-charts">
      <Card
        title="Invoiced against collected"
        subtitle="The last six months of money owed set against money that actually arrived."
      >
        <Suspense fallback={<ChartPlaceholder />}>
          <OwedCollectedChart data={data.monthly} />
        </Suspense>
      </Card>
      <Card
        title="How old the money is"
        subtitle="The longer a balance sits in a later bucket, the less likely it is to arrive."
      >
        <Suspense fallback={<ChartPlaceholder />}>
          <AgingChart aging={data.aging} />
        </Suspense>
        {overdue > 0 && (
          <p className="muted small" style={{ marginTop: 10 }}>
            <AlertCircle size={13} style={{ verticalAlign: "-2px" }} /> {overdue} account
            {overdue === 1 ? " is" : "s are"} past due. Start with the oldest bucket.
          </p>
        )}
      </Card>
    </div>
  );
}
