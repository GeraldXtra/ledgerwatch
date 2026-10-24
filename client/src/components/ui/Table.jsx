export function Table({ columns, stack = true, className = "", children }) {
  return (
    <div className="table-wrap">
      <table className={[stack ? "table table-stack" : "table", className].filter(Boolean).join(" ")}>
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
