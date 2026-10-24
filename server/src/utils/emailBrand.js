const FONT = "'Open Sans','Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const INK = "#16191F";
const BODY = "#414750";
const MUTED = "#687078";
const LINE = "#EAEDED";
const WELL = "#F7F8F8";
const PAGE = "#F2F3F3";
const ACCENT = "#FF9900";
const ACCENT_INK = "#A84400";
const POS = "#1D8102";
const NEG = "#D13212";
const TOPBAR = "#16191F";

function esc(s) {
  return String(s == null ? "" : s).replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])
  );
}

function safeHref(raw) {
  try {
    const u = new URL(String(raw || ""));
    return ["https:", "http:", "mailto:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

function appUrl(path = "/app") {
  const base = String(process.env.CLIENT_URL || "http://localhost:5173")
    .split(",")[0]
    .trim()
    .replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function brandHeader({ hasLogo, subtitle }) {
  const logo = hasLogo
    ? `<td style="padding-right:12px;vertical-align:middle">
         <img src="cid:ledgerwatch-logo" width="34" height="34" alt="LedgerWatch"
              style="display:block;border:0;border-radius:8px" />
       </td>`
    : "";
  return `<tr><td style="background:${TOPBAR};padding:18px 28px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        ${logo}
        <td style="vertical-align:middle">
          <div style="font:700 18px ${FONT};color:#FFFFFF;letter-spacing:-.2px">Ledger<span style="color:${ACCENT}">Watch</span></div>
          ${subtitle ? `<div style="font:400 12px ${FONT};color:#D5DBDB;padding-top:2px">${esc(subtitle)}</div>` : ""}
        </td>
      </tr>
    </table>
  </td></tr>
  <tr><td style="height:4px;background:${ACCENT};line-height:4px;font-size:0">&nbsp;</td></tr>`;
}

function shell({ title, preheader, headerHtml, bodyHtml, footerHtml }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};-webkit-text-size-adjust:100%">
<div style="display:none;font-size:1px;color:${PAGE};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${esc(preheader || "")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};padding:28px 12px">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
           style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid ${LINE};border-radius:12px;overflow:hidden">
      ${headerHtml}
      ${bodyHtml}
      ${footerHtml}
    </table>
  </td></tr>
</table>
</body></html>`;
}

function detailRows(rows) {
  const list = (rows || []).filter((r) => r && r.value != null && r.value !== "");
  if (!list.length) return "";
  return `<tr><td style="padding:16px 28px 4px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:10px">
      ${list
        .map(
          (r, i) => `<tr>
        <td style="padding:11px 16px;font:400 13px ${FONT};color:${MUTED};${i ? `border-top:1px solid ${LINE};` : ""}vertical-align:top">${esc(r.label)}</td>
        <td style="padding:11px 16px;font:600 13px ${r.mono ? MONO : FONT};color:${INK};text-align:right;word-break:break-all;${i ? `border-top:1px solid ${LINE};` : ""}">${
          safeHref(r.href) ? `<a href="${esc(safeHref(r.href))}" style="color:${ACCENT_INK};text-decoration:underline">${esc(r.value)}</a>` : esc(r.value)
        }</td>
      </tr>`
        )
        .join("")}
    </table>
  </td></tr>`;
}

function button({ label, url: raw }) {
  const url = safeHref(raw);
  if (!label || !url) return "";
  return `<tr><td style="padding:20px 28px 4px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr><td bgcolor="${ACCENT}" style="border-radius:999px">
        <a href="${esc(url)}" style="display:inline-block;padding:12px 24px;font:700 14px ${FONT};color:${INK};text-decoration:none;border-radius:999px">${esc(label)}</a>
      </td></tr>
    </table>
  </td></tr>`;
}

const TONES = {
  pos: { color: POS, soft: "#F2F8F0" },
  neg: { color: NEG, soft: "#FDF3F1" },
  info: { color: ACCENT_INK, soft: "#FFF4E5" },
};

function renderActivityEmail({
  hasLogo,
  subtitle,
  preheader,
  title,
  intro,
  tone = "info",
  hero,
  rows,
  cta,
  footnote,
}) {
  const t = TONES[tone] || TONES.info;
  const heroHtml = hero
    ? `<tr><td style="padding:4px 28px 4px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${t.soft};border-radius:10px">
          <tr><td style="padding:16px 18px">
            <div style="font:600 12px ${FONT};color:${MUTED}">${esc(hero.label)}</div>
            <div style="font:700 26px ${FONT};color:${t.color};padding-top:4px">${esc(hero.value)}</div>
            ${hero.sub ? `<div style="font:400 13px ${FONT};color:${BODY};padding-top:4px">${esc(hero.sub)}</div>` : ""}
          </td></tr>
        </table>
      </td></tr>`
    : "";

  const bodyHtml = `<tr><td style="padding:24px 28px 8px">
      <div style="font:700 21px/1.3 ${FONT};color:${INK}">${esc(title)}</div>
      ${intro ? `<p style="margin:10px 0 0;font:400 15px/1.65 ${FONT};color:${BODY}">${esc(intro)}</p>` : ""}
    </td></tr>
    ${heroHtml}
    ${detailRows(rows)}
    ${button(cta || {})}`;

  const footerHtml = `<tr><td style="padding:22px 28px 24px">
      <div style="border-top:1px solid ${LINE};padding-top:16px;font:400 12px/1.6 ${FONT};color:${MUTED}">
        ${footnote ? `${esc(footnote)}<br>` : ""}
        You receive these emails because activity notifications are on for your account.
        Change them in Settings, Notifications, at <a href="${esc(appUrl("/app/settings?section=notifications"))}" style="color:${ACCENT_INK}">LedgerWatch</a>.
      </div>
    </td></tr>`;

  return shell({
    title,
    preheader: preheader || intro || title,
    headerHtml: brandHeader({ hasLogo, subtitle }),
    bodyHtml,
    footerHtml,
  });
}

function activityText({ title, intro, rows, cta, footnote }) {
  const lines = [title, ""];
  if (intro) lines.push(intro, "");
  for (const r of rows || []) {
    if (r && r.value != null && r.value !== "") lines.push(`${r.label}: ${r.value}`);
  }
  if (cta && cta.url) lines.push("", `${cta.label}: ${cta.url}`);
  if (footnote) lines.push("", footnote);
  lines.push("", "Change these emails in Settings, Notifications.");
  return lines.join("\n");
}

module.exports = {
  FONT,
  MONO,
  INK,
  BODY,
  MUTED,
  LINE,
  WELL,
  PAGE,
  ACCENT,
  ACCENT_INK,
  POS,
  NEG,
  TOPBAR,
  esc,
  safeHref,
  appUrl,
  brandHeader,
  shell,
  detailRows,
  button,
  renderActivityEmail,
  activityText,
};
