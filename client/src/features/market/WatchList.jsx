import { useState } from "react";
import { Eye, Pencil, X } from "lucide-react";
import { conditionText, price as fmtPrice } from "./format";
import { Button, Card, EmptyState } from "../../components/ui";
import WatchEditRow from "./WatchEditRow";

/**
 * Active watches with editable conditions (PATCH, no delete/recreate) and remove.
 * `onEdit(watch, {type,value})` and `onRemove(watch)` are provided by the parent.
 */
export default function WatchList({ watches, onEdit, onRemove }) {
  const [editingId, setEditingId] = useState(null);

  return (
    <Card eyebrow="Watches" title="Active watches" subtitle="Conditions the agent checks every pass.">
      {watches.length === 0 ? (
        <EmptyState
          icon={<Eye size={20} />}
          title="Nothing being watched"
          hint={'Add a coin above, or ask the agent — try "watch BTC drop 5%" in the chat.'}
        />
      ) : (
        <ul className="plain-list">
          {watches.map((w) =>
            editingId === w._id ? (
              <li key={w._id} className="list-row">
                <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                  <span className="coin-chip">{w.symbol}</span>
                  <span className="muted small">edit condition</span>
                </div>
                <WatchEditRow
                  watch={w}
                  onCancel={() => setEditingId(null)}
                  onSave={async (payload) => {
                    await onEdit(w, payload);
                    setEditingId(null);
                  }}
                />
              </li>
            ) : (
              <li key={w._id} className="row space-between list-row">
                <div className="row">
                  <span className="coin-chip">{w.symbol}</span>
                  <div>
                    <div className="small" style={{ color: "var(--ink)", fontWeight: 500 }}>
                      when {conditionText(w.condition)}
                    </div>
                    {w.baselinePrice != null && (
                      <div className="muted caption num">baseline {fmtPrice(w.baselinePrice)}</div>
                    )}
                  </div>
                </div>
                <div className="row">
                  <Button variant="ghost" size="sm" icon title="Edit condition" onClick={() => setEditingId(w._id)}>
                    <Pencil size={13} />
                  </Button>
                  <Button variant="ghost" size="sm" icon title="Stop watching" onClick={() => onRemove(w)}>
                    <X size={14} />
                  </Button>
                </div>
              </li>
            )
          )}
        </ul>
      )}
    </Card>
  );
}
