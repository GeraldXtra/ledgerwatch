import { AlertCircle } from "lucide-react";
import { Card, SkeletonBlock } from "../../components/ui";
import OwedCollectedChart from "./OwedCollectedChart";
import AgingChart from "./AgingChart";

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
        <OwedCollectedChart data={data.monthly} />
      </Card>
      <Card
        title="How old the money is"
        subtitle="The longer a balance sits in a later bucket, the less likely it is to arrive."
      >
        <AgingChart aging={data.aging} />
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
