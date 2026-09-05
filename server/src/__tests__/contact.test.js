/**
 * The public Contact form.
 *
 * Anyone can post to it, so it is tested the way it will be used: with junk,
 * with a bot's honeypot fill, with a pasted wallet secret, and with a real
 * message from a signed in account. Email is unconfigured here, so the row
 * must be stored and must say the owner was not told.
 */

process.env.TURNSTILE_SECRET_KEY = "";
process.env.SMTP_HOST = "";
process.env.SMTP_USER = "";
process.env.SMTP_PASS = "";
process.env.MAIL_FROM = "";
process.env.CONTACT_EMAIL = "";
process.env.JWT_SECRET = "a-test-secret-that-is-long-enough-to-pass-the-boot-check";

const ContactMessage = require("../models/ContactMessage");
const User = require("../models/User");
const signToken = require("../utils/token");
const { submit, containsSecret } = require("../controllers/contact.controller");

function mockRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  return res;
}

function mockReq(body, headers = {}) {
  return { body, headers: { "user-agent": "vitest", ...headers }, ip: "127.0.0.1" };
}

const GOOD = {
  name: "Ada Okoye",
  email: "Ada@Example.com",
  topic: "wallet",
  message: "My balance on Base shows as unavailable since this morning.",
  page: "/app/wallet",
};

describe("contact form", () => {
  it("stores a valid message, lowercases the email, and records that no email went out", async () => {
    const res = mockRes();
    await submit(mockReq(GOOD), res);
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ ok: true });

    const rows = await ContactMessage.find({});
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("ada@example.com");
    expect(rows[0].topic).toBe("wallet");
    expect(rows[0].page).toBe("/app/wallet");
    expect(rows[0].userId).toBeNull();
    expect(rows[0].emailed).toBe(false);
    expect(rows[0].emailError).toBeTruthy();
  });

  it("refuses a missing name, a bad email and a message that is too short", async () => {
    for (const bad of [
      { ...GOOD, name: "" },
      { ...GOOD, email: "not-an-address" },
      { ...GOOD, message: "help" },
    ]) {
      const res = mockRes();
      await submit(mockReq(bad), res);
      expect(res.statusCode).toBe(400);
      expect(typeof res.body.error).toBe("string");
    }
    expect(await ContactMessage.countDocuments({})).toBe(0);
  });

  it("answers a honeypot submission with success and stores nothing", async () => {
    const res = mockRes();
    await submit(mockReq({ ...GOOD, website: "http://spam.example" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(await ContactMessage.countDocuments({})).toBe(0);
  });

  it("refuses a message that carries a private key or a recovery phrase", async () => {
    const key = `0x${"ab".repeat(32)}`;
    const phrase = "abandon ability able about above absent absorb abstract absurd abuse access accident";
    expect(containsSecret(`here is my key ${key} please fix`)).toBe("a private key");
    expect(containsSecret(`my phrase is\n${phrase}\nthanks`)).toBe("a recovery phrase");
    // An ordinary sentence of short words is not a phrase.
    expect(containsSecret("i sent the money to the wrong address and it did not arrive at all")).toBeNull();

    for (const message of [`please help ${key}`, `${phrase}`]) {
      const res = mockRes();
      await submit(mockReq({ ...GOOD, message }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/remove it/i);
    }
    expect(await ContactMessage.countDocuments({})).toBe(0);
  });

  it("caps every length and falls back to the general topic for an unknown one", async () => {
    const res = mockRes();
    await submit(
      mockReq({
        ...GOOD,
        name: "N".repeat(500),
        topic: "$where",
        message: "m".repeat(9000),
        page: "p".repeat(900),
      }),
      res
    );
    expect(res.statusCode).toBe(201);
    const row = await ContactMessage.findOne({});
    expect(row.name).toHaveLength(80);
    expect(row.topic).toBe("other");
    expect(row.message).toHaveLength(4000);
    expect(row.page).toHaveLength(200);
  });

  it("attributes a message to the signed in account when a valid token is sent, and ignores a bad one", async () => {
    const user = await User.create({
      name: "Owner",
      email: "owner@example.com",
      passwordHash: "not-a-real-hash",
    });
    const good = signToken(user._id, user.tokenVersion);

    const res1 = mockRes();
    await submit(mockReq(GOOD, { authorization: `Bearer ${good}` }), res1);
    expect(res1.statusCode).toBe(201);

    const res2 = mockRes();
    await submit(mockReq(GOOD, { authorization: "Bearer not.a.token" }), res2);
    expect(res2.statusCode).toBe(201);

    const rows = await ContactMessage.find({}).sort({ createdAt: 1 });
    expect(rows).toHaveLength(2);
    expect(String(rows[0].userId)).toBe(String(user._id));
    expect(rows[1].userId).toBeNull();
  });
});
