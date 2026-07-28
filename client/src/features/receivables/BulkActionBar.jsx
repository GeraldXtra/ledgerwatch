import { BellRing, X } from "lucide-react";
import { Button } from "../../components/ui";

/**
 * Floating bar shown when rows are selected. Remind or clear the selection.
 */
export default function BulkActionBar({ count, onRemind, onClear, busy }) {
  if (count === 0) return null;
  return (
    <div className="bulk-bar">
      <span className="bulk-count num">{count} selected</span>
      <div className="row">
        <Button size="sm" variant="primary" onClick={onRemind} loading={busy}>
          <BellRing size={14} /> Remind selected
        </Button>
        <Button size="sm" variant="ghost" icon title="Clear selection" onClick={onClear}>
          <X size={15} />
        </Button>
      </div>
    </div>
  );
}
