// Tiny client-side CSV export (no dependency). Triggers a file download.

/**
 * A cell that starts with =, +, -, @ or a tab or carriage return is read by
 * Excel and LibreOffice as a FORMULA, not text. A debtor named "=HYPERLINK(...)"
 * or "=cmd|' /C calc'!A0" would execute when the owner opened their own export.
 * Such cells are prefixed with an apostrophe, which spreadsheets show as
 * literal text, and quoted so the comma rule still holds.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function esc(value) {
  let s = value == null ? "" : String(value);
  if (FORMULA_LEAD.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) || s.startsWith("'") ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {string} filename
 * @param {string[]} headers
 * @param {Array<Array<any>>} rows
 */
export function downloadCsv(filename, headers, rows) {
  const lines = [headers.map(esc).join(",")];
  for (const r of rows) lines.push(r.map(esc).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
