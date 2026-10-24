import { useState } from "react";
import { Eye, Pencil, X } from "lucide-react";
import { conditionText, price as fmtPrice } from "./format";
import { Button, Card, EmptyState } from "../../components/ui";
import WatchEditRow from "./WatchEditRow";

export default function WatchList({ watches, onEdit, onRemove }) {
  const [editingId, setEditingId] = useState(null);

  return (
    <Card
      eyebrow="Watches"
      title="Active watches"
      count={watches.length}
      subtitle="Conditions the agent checks every pass."
      className="card-flush"
    >
      {watches.length === 0 ? (
        <EmptyState
          icon={<Eye size={20} />}
          title="Nothing being watched"
          hint={'Add a coin above, or ask the agent. Try "watch BTC drop 5%" in the chat.'}
        />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack watch-table">
            <thead>
              <tr>
                <th>Coin</th>
                <th>Condition</th>
                <th>Baseline</th>
                <th className="ta-right" />
              </tr>
            </thead>
            <tbody>
              {watches.map((w) =>
                editingId === w._id ? (
                  <tr key={w._id}>
                    <td data-label="" className="cell-title">
                      <span className="row" style={{ gap: 8 }}>
                        <span className="coin-chip">{w.symbol}</span>
                        <span className="muted small">edit condition</span>
                      </span>
                    </td>
                    <td data-label="" colSpan={3} className="watch-edit-cell">
                      <WatchEditRow
                        watch={w}
                        onCancel={() => setEditingId(null)}
                        onSave={async (payload) => {
                          await onEdit(w, payload);
                          setEditingId(null);
                        }}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={w._id}>
                    <td data-label="" className="cell-title">
                      <span className="coin-chip">{w.symbol}</span>
                    </td>
                    <td data-label="Condition">when {conditionText(w.condition)}</td>
                    <td data-label="Baseline" className="num">
                      {w.baselinePrice != null ? fmtPrice(w.baselinePrice) : ""}
                    </td>
                    <td data-label="" className="ta-right cell-end">
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        <Button variant="ghost" size="sm" icon title="Edit condition" onClick={() => setEditingId(w._id)}>
                          <Pencil size={13} />
                        </Button>
                        <Button variant="ghost" size="sm" icon title="Stop watching" onClick={() => onRemove(w)}>
                          <X size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
