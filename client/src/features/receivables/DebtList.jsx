import { ArrowDown, ArrowUp, BellRing, Check, Inbox, Pencil, Trash2, Wallet } from "lucide-react";
import { Avatar, EmptyState, KebabMenu, StatusPill } from "../../components/ui";
import { ngn, shortDate } from "./format";
import ProgressBar from "./ProgressBar";

const SORTABLE = [
  { key: "debtor", label: "Debtor" },
  { key: "amount", label: "Amount", align: "right" },
  { key: "balance", label: "Balance", align: "right" },
  { key: "due", label: "Due date", align: "right" },
  { key: "status", label: "Status" },
];

/**
 * Debts table with row selection, balance + mini progress, sortable headers,
 * partial status, row click -> detail. Sorting is server-driven via onSort.
 */
export default function DebtList({
  debts,
  sort,
  onSort,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
  onEdit,
  onDelete,
  onMarkPaid,
  onRemind,
  onRecordPayment,
  onAdd,
}) {
  if (!debts.length) {
    return (
      <EmptyState
        icon={<Inbox size={20} />}
        title="No debts match"
        hint="Record a credit sale or clear your filters. LedgerWatch drafts reminders that reference the outstanding balance."
        action={
          onAdd && (
            <button type="button" className="btn btn-primary" onClick={onAdd}>
              Record a debt
            </button>
          )
        }
      />
    );
  }

  const allSelected = selected && debts.every((d) => selected.has(d._id));
  const arrow = (key) =>
    sort === key ? <ArrowDown size={12} /> : sort === `${key}_asc` ? <ArrowUp size={12} /> : null;

  return (
    <div className="table-wrap">
      <table className="table table-stack debts-table">
        <thead>
          <tr>
            <th className="check-col">
              <input
                type="checkbox"
                aria-label="Select all"
                checked={!!allSelected}
                onChange={onToggleAll}
              />
            </th>
            {SORTABLE.map((c) => (
              <th key={c.key} className={c.align === "right" ? "ta-right" : ""}>
                <button
                  type="button"
                  className={`th-sort ${c.align === "right" ? "right" : ""}`}
                  onClick={() => onSort(c.key)}
                >
                  {c.label} {arrow(c.key)}
                </button>
              </th>
            ))}
            <th className="ta-right" />
          </tr>
        </thead>
        <tbody>
          {debts.map((debt) => {
            const status = debt.displayStatus || "pending";
            const paid = status === "paid";
            const balance = debt.balance != null ? debt.balance : debt.amount;
            const isSel = selected && selected.has(debt._id);
            return (
              <tr key={debt._id} className={`clickable-row ${isSel ? "row-selected" : ""}`}>
                <td data-label="" className="check-col" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${debt.debtorName}`}
                    checked={!!isSel}
                    onChange={() => onToggle(debt._id)}
                  />
                </td>
                <td data-label="Debtor" onClick={() => onOpen(debt)}>
                  <div className="cell-lead">
                    <Avatar name={debt.debtorName} />
                    <div>
                      <div className="lead-name">{debt.debtorName}</div>
                      <div className="lead-sub num">{debt.debtorPhone || "no phone on file"}</div>
                    </div>
                  </div>
                </td>
                <td data-label="Amount" align="right" className="ta-right num" onClick={() => onOpen(debt)}>
                  {ngn(debt.amount, debt.currency)}
                </td>
                <td data-label="Balance" align="right" className="ta-right num" onClick={() => onOpen(debt)}>
                  <div className="balance-cell">
                    <span className={balance > 0 ? "" : "value-pos"}>{ngn(balance, debt.currency)}</span>
                    <ProgressBar paid={debt.amountPaid || 0} total={debt.amount} size="sm" />
                  </div>
                </td>
                <td data-label="Due date" align="right" className="ta-right num" onClick={() => onOpen(debt)}>
                  {shortDate(debt.dueDate)}
                </td>
                <td data-label="Status" onClick={() => onOpen(debt)}>
                  <StatusPill status={status} />
                </td>
                <td data-label="" onClick={(e) => e.stopPropagation()}>
                  <div className="row" style={{ justifyContent: "flex-end" }}>
                    <KebabMenu
                      label={`Actions for ${debt.debtorName}`}
                      items={[
                        ...(!paid
                          ? [{ label: "Record payment", icon: <Wallet size={14} />, onSelect: () => onRecordPayment(debt) }]
                          : []),
                        { label: "Generate reminder", icon: <BellRing size={14} />, onSelect: () => onRemind(debt) },
                        ...(!paid
                          ? [{ label: "Mark fully paid", icon: <Check size={14} />, onSelect: () => onMarkPaid(debt) }]
                          : []),
                        { label: "Edit", icon: <Pencil size={14} />, onSelect: () => onEdit(debt) },
                        { label: "Delete", icon: <Trash2 size={14} />, danger: true, onSelect: () => onDelete(debt) },
                      ]}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
