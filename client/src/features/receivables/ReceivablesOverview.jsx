import { AlertCircle } from "lucide-react";
import { Card, SkeletonBlock } from "../../components/ui";
import { Suspense, lazy } from "react";

const OwedCollectedChart = lazy(() => import("./OwedCollectedChart"));
const AgingChart = lazy(() => import("./AgingChart"));

function ChartPlaceholder() {
  return <div className="chart-placeholder" aria-hidden="true" />;
}

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
