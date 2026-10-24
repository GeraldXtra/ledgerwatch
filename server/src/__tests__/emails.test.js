const fs = require("fs");
const path = require("path");
const { renderActivityEmail, activityText } = require("../utils/emailBrand");
const { buildPaymentReceiptEmail } = require("../utils/paymentReceipt");
const notifyService = require("../services/notify.service");

const ATTACK = `<script>alert(1)</script><img src=x onerror=alert(2)>"'`;

describe("emails — the brand, the logo and nothing a debtor's name can break", () => {
  it("carries the logo from inside the server, so it never depends on the client folder being deployed", () => {
    const asset = path.resolve(__dirname, "../assets/email-logo.png");
    expect(fs.existsSync(asset)).toBe(true);
    const logo = notifyService.getLogoAttachment();
    expect(logo).toMatchObject({ cid: "ledgerwatch-logo" });
    expect(Buffer.compare(logo.content, fs.readFileSync(asset))).toBe(0);
  });

  it("escapes every field of an activity email", () => {
    const html = renderActivityEmail({
      hasLogo: true,
      title: ATTACK,
      intro: ATTACK,
      hero: { label: ATTACK, value: ATTACK, sub: ATTACK },
      rows: [{ label: ATTACK, value: ATTACK, href: `javascript:${ATTACK}` }],
      cta: { label: ATTACK, url: "https://useledgerwatch.co/app" },
      footnote: ATTACK,
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("cid:ledgerwatch-logo");
  });

  it("escapes a debtor's name and business name in a receipt", () => {
    const { html } = buildPaymentReceiptEmail({
      businessName: ATTACK,
      debtorName: ATTACK,
      method: "bank",
      creditNgn: 5000,
      fullyPaid: true,
      hasLogo: true,
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("cid:ledgerwatch-logo");
  });

  it("escapes the reminder letter and the bank details", () => {
    const html = notifyService.buildReminderEmail({
      businessName: ATTACK,
      messageText: `Hello ${ATTACK}`,
      bankDetails: { bankName: ATTACK, accountName: ATTACK, accountNumber: ATTACK },
      amount: 50000,
      dueDate: "1 Nov 2026",
      debtorName: ATTACK,
      hasLogo: true,
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
  });

  it("writes a plain text part with every row", () => {
    const text = activityText({ title: "You received 25 USDC", intro: "Money arrived.", rows: [{ label: "Network", value: "Base" }], cta: { label: "Open", url: "https://x.test" } });
    expect(text).toContain("Network: Base");
    expect(text).toContain("Open: https://x.test");
  });

  it("uses no dashes in the shared email layout", () => {
    const html = renderActivityEmail({ hasLogo: false, title: "t", intro: "i", rows: [{ label: "a", value: "b" }] });
    const text = html.replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/[—–]/);
  });
});
