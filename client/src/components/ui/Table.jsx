/**
 * Data table. `columns`: [{ key, label, align?: "right", className? }].
 * `stack` (default true) collapses rows into labeled cards on mobile — cells
 * must carry data-label, which renderRow provides via the `cell` helper.
 */
export function Table({ columns, stack = true, children }) {
  return (
    <div className="table-wrap">
      <table className={stack ? "table table-stack" : "table"}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === "right" ? "ta-right" : ""}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** Cell helper that wires the mobile data-label. */
export function Td({ label = "", align, className = "", children }) {
  const cls = [align === "right" ? "ta-right" : "", "num", className]
    .filter(Boolean)
    .join(" ");
  return (
    <td data-label={label} className={cls}>
      {children}
    </td>
  );
}
