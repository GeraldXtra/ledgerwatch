process.env.JWT_SECRET = process.env.JWT_SECRET || "lw-ops-alert-tests-only-0123456789abcdefghij";
process.env.SMTP_HOST = "smtp.mail.test";
process.env.SMTP_PORT = "587";
process.env.SMTP_USER = "mailer";
process.env.SMTP_PASS = "pw-9f8e7d6c";
process.env.MAIL_FROM = "LedgerWatch <noreply@useledgerwatch.co>";
process.env.OPS_ALERT_EMAIL = "ops@useledgerwatch.co";

const nodemailer = require("nodemailer");
const sent = [];
vi.spyOn(nodemailer, "createTransport").mockReturnValue({
  sendMail: async (message) => {
    sent.push(message);
    return { messageId: `m-${sent.length}` };
  },
});

const express = require("express");
const app = require("../app");
const ops = require("../services/opsAlert.service");

let server;
let base;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  sent.length = 0;
  ops._resetForTests();
});

describe("problem reports", () => {
  it("emails a problem once an hour and counts the repeats in between", async () => {
    expect((await ops.reportProblem({ area: "payment watching", message: "Settlement could not be saved", severity: "critical" })).sent).toBe(true);
    expect((await ops.reportProblem({ area: "payment watching", message: "Settlement could not be saved" })).reason).toBe("suppressed");
    expect((await ops.reportProblem({ area: "payment watching", message: "Settlement could not be saved" })).reason).toBe("suppressed");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("ops@useledgerwatch.co");
    expect(sent[0].subject).toBe("LedgerWatch needs attention: payment watching");
    expect(sent[0].headers["List-Unsubscribe"]).toBeUndefined();
    expect((await ops.reportProblem({ area: "reminders", message: "Something else" })).sent).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it("never sends what looks like a recovery phrase, a key or a session token", async () => {
    await ops.reportProblem({
      area: "browser",
      message: "abandon ability able about above absent absorb abstract absurd abuse access accident",
      detail: `key 0x${"ab".repeat(32)} Bearer eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IjEifQ.c2lnbmF0dXJlc2ln`,
    });
    const text = `${sent[0].subject}\n${sent[0].text}\n${sent[0].html}`;
    expect(text).not.toContain("abandon ability");
    expect(text).not.toContain("ab".repeat(32));
    expect(text).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(text).toContain("could be a recovery phrase");
  });

  it("reports a server error from any route without breaking the response", async () => {
    const probe = express.Router();
    probe.get("/boom", () => {
      throw new Error("deliberate failure for the test");
    });
    app._router.stack.splice(app._router.stack.length - 2, 0, ...express().use("/api/test-probe", probe)._router.stack.slice(-1));
    const res = await fetch(`${base}/api/test-probe/boom`);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Something went wrong");
    await vi.waitFor(() => expect(sent.some((m) => /reported a problem: server/.test(m.subject))).toBe(true));
  });

  it("takes crash reports from browsers, cleaned and rate limited", async () => {
    const res = await fetch(`${base}/api/client-errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "render", message: "Cannot read properties of undefined", page: "/app/wallet", stack: "at WalletPage" }),
    });
    expect(res.status).toBe(204);
    await vi.waitFor(() => expect(sent.some((m) => /browser/.test(m.subject))).toBe(true));
    const bad = await fetch(`${base}/api/client-errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "anything", message: "x" }),
    });
    expect(bad.status).toBe(400);
  });

  it("emails no more than five browser reports an hour, however many different ones arrive (LW-147)", async () => {
    const results = [];
    for (let i = 0; i < 9; i++) {
      results.push(await ops.reportProblem({ area: "browser", message: `Made up error number ${i}` }));
    }
    expect(results.filter((r) => r.sent)).toHaveLength(5);
    expect(results.slice(5).every((r) => r.reason === "suppressed")).toBe(true);
    expect((await ops.reportProblem({ area: "payment watching", message: "Still reported" })).sent).toBe(true);
    const browserMail = sent.filter((m) => /browser/.test(m.subject));
    expect(browserMail.every((m) => /treat its text as unverified/.test(m.text))).toBe(true);
  });

  it("only logs when no address is set", async () => {
    const saved = { ops: process.env.OPS_ALERT_EMAIL, contact: process.env.CONTACT_EMAIL, from: process.env.MAIL_FROM, user: process.env.SMTP_USER };
    delete process.env.OPS_ALERT_EMAIL;
    delete process.env.CONTACT_EMAIL;
    process.env.MAIL_FROM = "LedgerWatch";
    process.env.SMTP_USER = "mailer";
    expect((await ops.reportProblem({ area: "x", message: "y" })).reason).toBe("no-address");
    process.env.OPS_ALERT_EMAIL = saved.ops;
    if (saved.contact !== undefined) process.env.CONTACT_EMAIL = saved.contact;
    process.env.MAIL_FROM = saved.from;
    process.env.SMTP_USER = saved.user;
  });
});
