const accounts = require("../repositories/accounts");
const { debtByToken } = require("../repositories/publicInvoices");
const {
  ensureInvoiceNumber,
  invoiceView,
  buildInvoicePdf,
  invoiceFileName,
  payPageUrl,
} = require("../services/invoice.service");
const unsubscribe = require("../services/unsubscribe.service");

const OWNER_FIELDS = "name companyName bankDetails";

function noIndex(res) {
  res.set("X-Robots-Tag", "noindex, nofollow");
}

async function loadInvoice(token) {
  const debt = await debtByToken(token);
  if (!debt) return null;
  const owner = await accounts.findById(debt.userId).select(OWNER_FIELDS).lean();
  if (!owner) return null;
  await ensureInvoiceNumber(debt);
  return { debt, owner };
}

async function invoice(req, res) {
  noIndex(res);
  try {
    const found = await loadInvoice(req.params.token);
    if (!found) return res.status(404).json({ error: "This payment link is not valid. Ask the business for a new one." });
    const view = await invoiceView(found.debt, found.owner);
    return res.json({ invoice: view, url: payPageUrl(req.params.token) });
  } catch (err) {
    console.error("public invoice error:", err.message);
    return res.status(500).json({ error: "This invoice could not be loaded just now. Try again in a moment." });
  }
}

async function invoicePdf(req, res) {
  noIndex(res);
  try {
    const found = await loadInvoice(req.params.token);
    if (!found) return res.status(404).json({ error: "This payment link is not valid. Ask the business for a new one." });
    const view = await invoiceView(found.debt, found.owner);
    const pdf = await buildInvoicePdf(view, { payUrl: payPageUrl(req.params.token) });
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `attachment; filename="${invoiceFileName(view)}"`);
    return res.send(pdf);
  } catch (err) {
    console.error("public invoice pdf error:", err.message);
    return res.status(500).json({ error: "The invoice PDF could not be made just now." });
  }
}

function maskEmail(email) {
  const [local, domain] = String(email || "").split("@");
  if (!domain) return null;
  return `${local.slice(0, 1)}${"*".repeat(Math.max(1, Math.min(local.length - 1, 6)))}@${domain}`;
}

async function describe(claims) {
  const owner = await accounts.findById(claims.userId).select("name companyName").lean();
  if (!owner) return null;
  const status = await unsubscribe.optOutStatus(claims);
  if (!status) return null;
  return {
    kind: claims.kind,
    businessName: owner.companyName || owner.name,
    email: claims.kind === "debtor" ? maskEmail(claims.email) : null,
    unsubscribed: status.unsubscribed,
  };
}

async function unsubscribeInfo(req, res) {
  noIndex(res);
  try {
    const claims = unsubscribe.readToken(req.params.token);
    const info = claims && (await describe(claims));
    if (!info) return res.status(404).json({ error: "This unsubscribe link is not valid any more." });
    return res.json(info);
  } catch (err) {
    console.error("unsubscribe info error:", err.message);
    return res.status(500).json({ error: "Your choice could not be loaded just now. Try again in a moment." });
  }
}

async function unsubscribeAct(req, res) {
  noIndex(res);
  try {
    const claims = unsubscribe.readToken(req.params.token);
    if (!claims || !(await describe(claims))) {
      return res.status(404).json({ error: "This unsubscribe link is not valid any more." });
    }
    const oneClick = req.body["List-Unsubscribe"] === "One-Click";
    if (!oneClick && req.body.action === "resubscribe") {
      await unsubscribe.optBackIn(claims);
    } else {
      await unsubscribe.optOut(claims, oneClick ? "one-click" : "page");
    }
    return res.json(await describe(claims));
  } catch (err) {
    console.error("unsubscribe error:", err.message);
    return res.status(500).json({ error: "Your choice could not be saved just now. Try again in a moment." });
  }
}

module.exports = { invoice, invoicePdf, unsubscribeInfo, unsubscribeAct, maskEmail };
