process.env.JWT_SECRET = process.env.JWT_SECRET || "lw-two-factor-tests-only-0123456789abcdefgh";
process.env.SMTP_HOST = "smtp.mail.test";
process.env.SMTP_PORT = "587";
process.env.SMTP_USER = "mailer";
process.env.SMTP_PASS = "pw-9f8e7d6c";
process.env.MAIL_FROM = "LedgerWatch <noreply@useledgerwatch.co>";
process.env.TURNSTILE_SECRET_KEY = "";

const nodemailer = require("nodemailer");
const sent = [];
vi.spyOn(nodemailer, "createTransport").mockReturnValue({
  sendMail: async (message) => {
    sent.push(message);
    return { messageId: `m-${sent.length}` };
  },
});

const bcrypt = require("bcryptjs");
const app = require("../app");
const User = require("../models/User");
const signToken = require("../utils/token");
const tf = require("../services/twoFactor.service");

let server;
let base;
let seq = 0;
const PASSWORD = "Correct-Horse-Battery-77";

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function anAccount() {
  const email = `twofa-${Date.now()}-${++seq}@business.ng`;
  const user = await User.create({ name: "Tolu", email, passwordHash: await bcrypt.hash(PASSWORD, 4), emailVerified: true });
  return { user, email, token: signToken(user._id, 0) };
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function codeAt(secretB32, offsetSteps = 0) {
  return tf.totp(tf.base32Decode(secretB32), Date.now() + offsetSteps * 30000);
}

async function turnOn(acct) {
  const setup = await call("POST", "/api/auth/me/2fa/setup", { token: acct.token, body: { password: PASSWORD } });
  expect(setup.status).toBe(200);
  expect(setup.body.otpauthUrl).toContain("otpauth://totp/LedgerWatch");
  expect(setup.body.qr).toMatch(/^data:image\/png;base64,/);
  const enabled = await call("POST", "/api/auth/me/2fa/enable", { token: acct.token, body: { code: codeAt(setup.body.secret) } });
  expect(enabled.status).toBe(200);
  expect(enabled.body.backupCodes).toHaveLength(10);
  return { secret: setup.body.secret, backupCodes: enabled.body.backupCodes };
}

describe("two-step sign-in", () => {
  it("is set up with a password and a code, and asks for a second step at sign in", async () => {
    const acct = await anAccount();
    const { secret } = await turnOn(acct);
    expect((await call("GET", "/api/auth/me", { token: acct.token })).body.user.twoFactorEnabled).toBe(true);

    const first = await call("POST", "/api/auth/login", { body: { email: acct.email, password: PASSWORD } });
    expect(first.status).toBe(200);
    expect(first.body.token).toBeUndefined();
    expect(first.body.twoFactorRequired).toBe(true);

    const wrong = await call("POST", "/api/auth/login/2fa", { body: { challenge: first.body.challenge, code: "000000" } });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatch(/attempts? left/);

    const ok = await call("POST", "/api/auth/login/2fa", { body: { challenge: first.body.challenge, code: codeAt(secret, 1) } });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    expect((await call("GET", "/api/auth/me", { token: ok.body.token })).status).toBe(200);
  });

  it("will not accept the same code twice", async () => {
    const acct = await anAccount();
    const { secret } = await turnOn(acct);
    const code = codeAt(secret, 1);
    const one = await call("POST", "/api/auth/login", { body: { email: acct.email, password: PASSWORD } });
    expect((await call("POST", "/api/auth/login/2fa", { body: { challenge: one.body.challenge, code } })).status).toBe(200);
    const two = await call("POST", "/api/auth/login", { body: { email: acct.email, password: PASSWORD } });
    expect((await call("POST", "/api/auth/login/2fa", { body: { challenge: two.body.challenge, code } })).status).toBe(400);
  });

  it("never lets the sign-in challenge stand in for a session", async () => {
    const acct = await anAccount();
    await turnOn(acct);
    const first = await call("POST", "/api/auth/login", { body: { email: acct.email, password: PASSWORD } });
    expect((await call("GET", "/api/auth/me", { token: first.body.challenge })).status).toBe(401);
  });

  it("accepts each backup code once", async () => {
    const acct = await anAccount();
    const { backupCodes } = await turnOn(acct);
    const one = await call("POST", "/api/auth/login", { body: { email: acct.email, password: PASSWORD } });
    const used = await call("POST", "/api/auth/login/2fa", { body: { challenge: one.body.challenge, code: backupCodes[0] } });
    expect(used.status).toBe(200);
    expect(used.body.backupCodesLeft).toBe(9);
    const two = await call("POST", "/api/auth/login", { body: { email: acct.email, password: PASSWORD } });
    expect((await call("POST", "/api/auth/login/2fa", { body: { challenge: two.body.challenge, code: backupCodes[0] } })).status).toBe(400);
  });

  it("locks the second step after five wrong codes", async () => {
    const acct = await anAccount();
    await turnOn(acct);
    const one = await call("POST", "/api/auth/login", { body: { email: acct.email, password: PASSWORD } });
    let last;
    for (let i = 0; i < 5; i++) {
      last = await call("POST", "/api/auth/login/2fa", { body: { challenge: one.body.challenge, code: "111111" } });
    }
    expect(last.status).toBe(429);
  });

  it("is turned off only with the password and a code, and says so by email", async () => {
    const acct = await anAccount();
    const { secret } = await turnOn(acct);
    expect((await call("POST", "/api/auth/me/2fa/disable", { token: acct.token, body: { password: "wrong", code: codeAt(secret, 1) } })).status).toBe(400);
    sent.length = 0;
    const off = await call("POST", "/api/auth/me/2fa/disable", { token: acct.token, body: { password: PASSWORD, code: codeAt(secret, 1) } });
    expect(off.status).toBe(200);
    expect(off.body.user.twoFactorEnabled).toBe(false);
    await vi.waitFor(() => expect(sent.some((m) => m.to === acct.email && /two-step sign-in is off/i.test(m.subject))).toBe(true));
    const login = await call("POST", "/api/auth/login", { body: { email: acct.email, password: PASSWORD } });
    expect(login.body.token).toBeTruthy();
  });

  it("refuses to start without the account password", async () => {
    const acct = await anAccount();
    expect((await call("POST", "/api/auth/me/2fa/setup", { token: acct.token, body: { password: "nope" } })).status).toBe(400);
  });
});

describe("changing the sign-in email", () => {
  it("sends a code to the new address, switches only once it is entered, and tells the old address", async () => {
    const acct = await anAccount();
    const newEmail = `moved-${Date.now()}@business.ng`;
    sent.length = 0;
    const start = await call("POST", "/api/auth/me/email", { token: acct.token, body: { newEmail, password: PASSWORD } });
    expect(start.status).toBe(200);
    expect(start.body.pendingEmail).toBe(newEmail);
    const mail = sent.find((m) => m.to === newEmail);
    const code = mail.text.match(/\b(\d{6})\b/)[1];
    expect((await User.findById(acct.user._id).lean()).email).toBe(acct.email);

    expect((await call("POST", "/api/auth/me/email/confirm", { token: acct.token, body: { code: "000000" } })).status).toBe(400);
    const done = await call("POST", "/api/auth/me/email/confirm", { token: acct.token, body: { code } });
    expect(done.status).toBe(200);
    expect(done.body.user.email).toBe(newEmail);
    expect((await call("GET", "/api/auth/me", { token: acct.token })).status).toBe(401);
    expect((await call("GET", "/api/auth/me", { token: done.body.token })).status).toBe(200);
    await vi.waitFor(() => expect(sent.some((m) => m.to === acct.email && /email was changed/i.test(m.subject))).toBe(true));
  });

  it("refuses an address another account already uses, and asks for the password", async () => {
    const a = await anAccount();
    const b = await anAccount();
    expect((await call("POST", "/api/auth/me/email", { token: a.token, body: { newEmail: b.email, password: PASSWORD } })).status).toBe(409);
    expect((await call("POST", "/api/auth/me/email", { token: a.token, body: { newEmail: "free@business.ng", password: "wrong" } })).status).toBe(400);
  });

  it("checks no more than six codes for one email change, however many arrive at once (LW-146)", async () => {
    const acct = await anAccount();
    const newEmail = `parallel-${Date.now()}@business.ng`;
    sent.length = 0;
    expect((await call("POST", "/api/auth/me/email", { token: acct.token, body: { newEmail, password: PASSWORD } })).status).toBe(200);
    const real = sent.find((m) => m.to === newEmail).text.match(/\b(\d{6})\b/)[1];
    const wrong = real === "000000" ? "111111" : "000000";
    const results = await Promise.all(
      Array.from({ length: 12 }, () => call("POST", "/api/auth/me/email/confirm", { token: acct.token, body: { code: wrong } }))
    );
    expect(results.filter((r) => r.status === 400).length).toBeLessThanOrEqual(6);
    expect(results.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(6);
    expect((await call("POST", "/api/auth/me/email/confirm", { token: acct.token, body: { code: real } })).status).toBe(429);
  });

  it("needs a code from the authenticator when two-step sign-in is on", async () => {
    const acct = await anAccount();
    const { secret } = await turnOn(acct);
    const without = await call("POST", "/api/auth/me/email", { token: acct.token, body: { newEmail: "x1@business.ng", password: PASSWORD } });
    expect(without.status).toBe(400);
    const withCode = await call("POST", "/api/auth/me/email", { token: acct.token, body: { newEmail: "x1@business.ng", password: PASSWORD, code: codeAt(secret, 1) } });
    expect(withCode.status).toBe(200);
  });
});

describe("two-step sign-in under requests sent at the same moment (LW-146)", () => {
  function aWrongCode(secret) {
    const valid = [-1, 0, 1].map((step) => codeAt(secret, step));
    return ["000000", "111111", "222222", "333333"].find((c) => !valid.includes(c));
  }

  it("checks no more than five codes before locking, however many arrive at once", async () => {
    const acct = await anAccount();
    const { secret } = await turnOn(acct);
    const wrong = aWrongCode(secret);
    const results = await Promise.all(Array.from({ length: 15 }, () => tf.useSecondFactor(acct.user._id, wrong)));
    expect(results.filter((r) => r.ok)).toHaveLength(0);
    expect(results.filter((r) => !r.locked).length).toBeLessThanOrEqual(4);
    expect(results.filter((r) => r.locked).length).toBeGreaterThanOrEqual(11);
    const right = await tf.useSecondFactor(acct.user._id, codeAt(secret, 1));
    expect(right.ok).toBe(false);
    expect(right.locked).toBe(true);
  });

  it("accepts one code once, even when it is sent twice at the same moment", async () => {
    const acct = await anAccount();
    const { secret } = await turnOn(acct);
    const code = codeAt(secret, 1);
    const results = await Promise.all([tf.useSecondFactor(acct.user._id, code), tf.useSecondFactor(acct.user._id, code)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("accepts a backup code once, even when it is sent twice at the same moment", async () => {
    const acct = await anAccount();
    const { backupCodes } = await turnOn(acct);
    const results = await Promise.all([
      tf.useSecondFactor(acct.user._id, backupCodes[3]),
      tf.useSecondFactor(acct.user._id, backupCodes[3]),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => r.ok).backupCodesLeft).toBe(9);
  });

  it("keeps the backup codes it showed when the switch-on is pressed twice", async () => {
    const acct = await anAccount();
    const setup = await call("POST", "/api/auth/me/2fa/setup", { token: acct.token, body: { password: PASSWORD } });
    const code = codeAt(setup.body.secret);
    const [one, two] = await Promise.all([
      call("POST", "/api/auth/me/2fa/enable", { token: acct.token, body: { code } }),
      call("POST", "/api/auth/me/2fa/enable", { token: acct.token, body: { code } }),
    ]);
    const winners = [one, two].filter((r) => r.status === 200);
    expect(winners).toHaveLength(1);
    expect([one, two].filter((r) => r.status === 409)).toHaveLength(1);
    const shown = winners[0].body.backupCodes[0];
    expect((await tf.useSecondFactor(acct.user._id, shown)).ok).toBe(true);
  });
});

describe("password reset codes under guesses sent at the same moment (LW-146)", () => {
  it("checks no more than six codes, however many arrive at once", async () => {
    const acct = await anAccount();
    sent.length = 0;
    expect((await call("POST", "/api/auth/forgot-password", { body: { email: acct.email } })).status).toBe(200);
    await vi.waitFor(() => expect(sent.some((m) => m.to === acct.email)).toBe(true));
    const real = sent.find((m) => m.to === acct.email).text.match(/\b(\d{6})\b/)[1];
    const wrong = real === "000000" ? "111111" : "000000";
    const newPassword = "Fresh-Strong-Pass-2026";
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        call("POST", "/api/auth/reset-password", { body: { email: acct.email, code: wrong, newPassword } })
      )
    );
    expect(results.filter((r) => r.body.reason === "mismatch").length).toBeLessThanOrEqual(6);
    expect(results.filter((r) => r.body.reason === "too-many-attempts").length).toBeGreaterThanOrEqual(6);
    const after = await call("POST", "/api/auth/reset-password", { body: { email: acct.email, code: real, newPassword } });
    expect(after.body.reason).toBe("too-many-attempts");
  });
});

describe("the shared demo account", () => {
  it("cannot turn on two-step sign-in or change its password or email, so nobody can lock others out", async () => {
    let demo = await User.findOne({ email: "demo@ledgerwatch.app" });
    if (!demo) demo = await User.create({ name: "Demo", email: "demo@ledgerwatch.app", passwordHash: await bcrypt.hash(PASSWORD, 4), emailVerified: true });
    const token = signToken(demo._id, demo.tokenVersion);
    expect((await call("POST", "/api/auth/me/2fa/setup", { token, body: { password: PASSWORD } })).status).toBe(403);
    expect((await call("POST", "/api/auth/me/password", { token, body: { currentPassword: PASSWORD, newPassword: "Another-Long-Pass-99" } })).status).toBe(403);
    expect((await call("POST", "/api/auth/me/email", { token, body: { newEmail: "taken-over@business.ng", password: PASSWORD } })).status).toBe(403);
  });
});
