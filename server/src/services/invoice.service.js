const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { scopedRepo } = require("../repositories/scoped");
const { attachTotals } = require("./receivables.service");
const { getChain } = require("../config/chains");
const { clientUrl } = require("../utils/links");

const ASSETS = path.join(__dirname, "..", "assets");
const LOGO = path.join(ASSETS, "email-logo.png");
const FONT_REGULAR = path.join(ASSETS, "fonts", "NotoSans-Regular.ttf");
const FONT_BOLD = path.join(ASSETS, "fonts", "NotoSans-Bold.ttf");

const INK = "#16191F";
const MUTED = "#687078";
const LINE = "#EAEDED";
const ACCENT = "#FF9900";

const STATUS_LABEL = {
  paid: "Paid",
  partially_paid: "Part paid",
  overdue: "Overdue",
  pending: "Awaiting payment",
};

function formatInvoiceNumber(n) {
  return `INV-${String(n).padStart(4, "0")}`;
}

async function nextInvoiceNumber(userId) {
  const owner = await scopedRepo(userId).self.update({ $inc: { invoiceSeq: 1 } }).select("invoiceSeq").lean();
  if (!owner) throw new Error("The account that owns this invoice no longer exists");
  return formatInvoiceNumber(owner.invoiceSeq);
}

async function ensureInvoiceNumber(debt) {
  if (debt.invoiceNumber) return debt.invoiceNumber;
  const debts = scopedRepo(debt.userId).debts;
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = await nextInvoiceNumber(debt.userId);
    try {
      const res = await debts.updateOne({ _id: debt._id, invoiceNumber: null }, { $set: { invoiceNumber: number } });
      if (res.modifiedCount) {
        debt.invoiceNumber = number;
        return number;
      }
    } catch (err) {
      if (!err || err.code !== 11000) throw err;
      continue;
    }
    const fresh = await debts.findById(debt._id).select("invoiceNumber").lean();
    if (fresh && fresh.invoiceNumber) {
      debt.invoiceNumber = fresh.invoiceNumber;
      return fresh.invoiceNumber;
    }
  }
  throw new Error("This invoice could not be given a number");
}

function newPublicToken() {
  return crypto.randomBytes(24).toString("base64url");
}

async function ensurePublicToken(debt) {
  if (debt.publicToken) return debt.publicToken;
  const debts = scopedRepo(debt.userId).debts;
  const token = newPublicToken();
  const res = await debts.updateOne(
    { _id: debt._id, publicToken: null },
    { $set: { publicToken: token, publicTokenCreatedAt: new Date() } }
  );
  if (res.modifiedCount) {
    debt.publicToken = token;
    return token;
  }
  const fresh = await debts.findById(debt._id).select("publicToken").lean();
  debt.publicToken = fresh && fresh.publicToken;
  return debt.publicToken;
}

async function rotatePublicToken(debt) {
  const token = newPublicToken();
  await scopedRepo(debt.userId).debts.updateOne(
    { _id: debt._id },
    { $set: { publicToken: token, publicTokenCreatedAt: new Date() } }
  );
  debt.publicToken = token;
  return token;
}

function payPageUrl(token) {
  return token ? clientUrl(`/pay/${token}`) : null;
}

function bankOf(owner) {
  const b = (owner && owner.bankDetails) || {};
  if (!b.accountNumber) return null;
  return {
    bankName: b.bankName || null,
    accountName: b.accountName || null,
    accountNumber: b.accountNumber,
  };
}

async function invoiceView(debt, owner) {
  const [totals] = await attachTotals(debt.userId, [debt]);
  const active =
    totals.balanceKobo > 0
      ? await scopedRepo(debt.userId).paymentAddresses.findOne({ debtId: debt._id, status: "active" }).lean()
      : null;
  const chain = active ? getChain(active.chainId) : null;
  return {
    businessName: (owner && (owner.companyName || owner.name)) || "LedgerWatch",
    invoiceNumber: debt.invoiceNumber || null,
    debtorName: debt.debtorName,
    issuedAt: debt.createdAt,
    dueDate: debt.dueDate,
    currency: debt.currency || "NGN",
    amount: totals.amount,
    amountPaid: totals.amountPaid,
    balance: totals.balance,
    status: totals.displayStatus,
    statusLabel: STATUS_LABEL[totals.displayStatus] || "Awaiting payment",
    note: debt.note || null,
    bank: totals.balanceKobo > 0 ? bankOf(owner) : null,
    crypto:
      active && chain
        ? {
            network: chain.name,
            testnet: Boolean(chain.testnet),
            tokenSymbol: active.tokenSymbol,
            address: active.address,
            expected: active.expectedUsdc,
            expiresAt: active.expiresAt,
            explorer: chain.explorer ? `${chain.explorer}/address/${active.address}` : null,
          }
        : null,
  };
}

function moneyText(amount, currency) {
  const n = Number(amount) || 0;
  const figure = n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "NGN" ? `₦${figure}` : `${currency} ${figure}`;
}

function dateText(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function buildInvoicePdf(view, { payUrl = null } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      info: {
        Title: view.invoiceNumber ? `Invoice ${view.invoiceNumber}` : "Invoice",
        Author: view.businessName,
        Creator: "LedgerWatch",
      },
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("body", FONT_REGULAR);
    doc.registerFont("bold", FONT_BOLD);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;
    const footerY = () => doc.page.height - doc.page.margins.bottom - 24;
    let y = doc.page.margins.top;
    const room = (needed) => {
      if (y + needed > footerY() - 12) {
        doc.addPage();
        y = doc.page.margins.top;
      }
    };

    doc.font("bold").fontSize(20).fillColor(INK).text(view.businessName, left, y, { width: width * 0.6 - 12 });
    const nameBottom = doc.y;
    doc
      .font("bold")
      .fontSize(20)
      .fillColor(INK)
      .text("Invoice", left + width * 0.6, y, { width: width * 0.4, align: "right" });
    doc
      .font("body")
      .fontSize(10)
      .fillColor(MUTED)
      .text(view.invoiceNumber || "", { width: width * 0.4, align: "right" })
      .text(view.statusLabel, { width: width * 0.4, align: "right" });
    y = Math.max(nameBottom, doc.y) + 10;

    doc.moveTo(left, y).lineTo(right, y).lineWidth(2).strokeColor(ACCENT).stroke();
    y += 16;

    const facts = [
      ["Billed to", view.debtorName],
      ["Issued", dateText(view.issuedAt)],
      ["Due", dateText(view.dueDate)],
    ];
    for (const [label, value] of facts) {
      doc.font("body").fontSize(9).fillColor(MUTED).text(label, left, y, { width: 90 });
      doc.font("bold").fontSize(11).fillColor(INK).text(value || "", left + 90, y - 1, { width: width - 90 });
      y = doc.y + 6;
    }

    y += 10;
    room(24 + 10 + 20);
    doc.rect(left, y, width, 24).fillColor("#F7F8F8").fill();
    doc.font("bold").fontSize(9).fillColor(MUTED).text("Description", left + 10, y + 7);
    doc.text("Amount", left, y + 7, { width: width - 10, align: "right" });
    y += 34;
    doc.font("body").fontSize(11).fillColor(INK);
    doc.text(moneyText(view.amount, view.currency), left + width * 0.7, y, { width: width * 0.3 - 10, align: "right" });
    doc.text(view.note || "Amount owed", left + 10, y, { width: width * 0.65 });
    y = doc.y + 12;

    room(12 + 3 * 22);
    doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor(LINE).stroke();
    y += 12;

    const totals = [
      ["Total", moneyText(view.amount, view.currency), false],
      ["Paid so far", moneyText(view.amountPaid, view.currency), false],
      ["Balance due", moneyText(view.balance, view.currency), true],
    ];
    for (const [label, value, strong] of totals) {
      doc.font(strong ? "bold" : "body").fontSize(strong ? 13 : 11).fillColor(INK);
      doc.text(label, left + width * 0.5, y, { width: width * 0.25 });
      doc.text(value, left + width * 0.75, y, { width: width * 0.25 - 10, align: "right" });
      y = doc.y + 6;
    }

    if (view.balance > 0 && (view.bank || view.crypto || payUrl)) {
      y += 18;
      room(20 + 60);
      doc.font("bold").fontSize(12).fillColor(INK).text("How to pay", left, y);
      y = doc.y + 6;
      if (view.bank) {
        room(60);
        doc.font("bold").fontSize(10).fillColor(INK).text("Bank transfer", left, y);
        doc.font("body").fontSize(10).fillColor(INK);
        if (view.bank.bankName) doc.text(`Bank: ${view.bank.bankName}`, { width });
        if (view.bank.accountName) doc.text(`Account name: ${view.bank.accountName}`, { width });
        doc.text(`Account number: ${view.bank.accountNumber}`, { width });
        y = doc.y + 8;
      }
      if (view.crypto) {
        room(70);
        doc.font("bold").fontSize(10).fillColor(INK).text(`${view.crypto.tokenSymbol} on ${view.crypto.network}`, left, y);
        doc.font("body").fontSize(10).fillColor(INK).text(`Send ${view.crypto.expected} ${view.crypto.tokenSymbol} to:`, { width });
        doc.font("body").fontSize(9).fillColor(INK).text(view.crypto.address, { width });
        doc
          .font("body")
          .fontSize(9)
          .fillColor(MUTED)
          .text(`Send only ${view.crypto.tokenSymbol} on ${view.crypto.network}. Anything else sent to this address may be lost.`, {
            width,
          });
        y = doc.y + 8;
      }
      if (payUrl) {
        room(32);
        doc.font("bold").fontSize(10).fillColor(INK).text("Pay online", left, y);
        doc.font("body").fontSize(10).fillColor(INK).text(payUrl, { width, link: payUrl, underline: true });
        y = doc.y;
      }
    }

    room(0);
    if (fs.existsSync(LOGO)) doc.image(LOGO, left, footerY(), { width: 18 });
    doc
      .font("body")
      .fontSize(8)
      .fillColor(MUTED)
      .text(`Prepared with LedgerWatch on ${dateText(new Date())}.`, left + 26, footerY() + 5, {
        width: width - 26,
        lineBreak: false,
      });

    doc.end();
  });
}

function invoiceFileName(view) {
  return `${(view.invoiceNumber || "invoice").replace(/[^A-Za-z0-9-]/g, "")}.pdf`;
}

module.exports = {
  formatInvoiceNumber,
  nextInvoiceNumber,
  ensureInvoiceNumber,
  ensurePublicToken,
  rotatePublicToken,
  payPageUrl,
  invoiceView,
  buildInvoicePdf,
  invoiceFileName,
};
