process.env.JWT_SECRET = process.env.JWT_SECRET || "lw-166-google-return-tests-0123456789abcdef";
process.env.CLIENT_URL = "https://www.useledgerwatch.co";
process.env.SERVER_URL = "https://api.useledgerwatch.co";
process.env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "client-secret-9f8e7d6c";

const axios = require("axios");
const jwt = require("jsonwebtoken");
const app = require("../app");
const google = require("../services/googleAuth.service");
const User = require("../models/User");

let server;
let base;
let seq = 0;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function start(query) {
  const res = await fetch(`${base}/api/auth/google?${query}`, { redirect: "manual" });
  const location = res.headers.get("location") || "";
  return { status: res.status, location, state: new URL(location).searchParams.get("state") };
}

async function callback(query) {
  const res = await fetch(`${base}/api/auth/google/callback?${query}`, { redirect: "manual" });
  return { status: res.status, location: res.headers.get("location") || "" };
}

function stubGoogle(email) {
  vi.spyOn(axios, "post").mockResolvedValue({ data: { access_token: "at-1" } });
  vi.spyOn(axios, "get").mockResolvedValue({
    data: { sub: `g-${email}`, email, email_verified: true, name: "Ada" },
  });
}

describe("LW-166 — a Google sign-in started in the Android app returns to the app", () => {
  it("the app flag travels inside the signed state and is read back from it", async () => {
    const nonce = "n".repeat(16);
    const fromApp = await start(`n=${nonce}&app=1`);
    expect(fromApp.status).toBe(302);
    expect(fromApp.location).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(google.verifyState(fromApp.state)).toMatchObject({ ok: true, nonce, app: true });

    const fromWeb = await start(`n=${nonce}`);
    expect(google.verifyState(fromWeb.state)).toMatchObject({ ok: true, nonce, app: false });

    const tampered = fromWeb.state.replace(".web.", ".app.");
    expect(google.verifyState(tampered)).toMatchObject({ ok: false, app: false });
  });

  it("the callback for an app sign-in lands on the page that hands the token to the app, with the nonce", async () => {
    const email = `lw166-${Date.now()}-${++seq}@example.com`;
    stubGoogle(email);
    const nonce = "a1b2c3d4e5f6g7h8";
    const { state } = await start(`n=${nonce}&app=1`);

    const res = await callback(`code=abc&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    const url = new URL(res.location);
    expect(`${url.origin}${url.pathname}`).toBe("https://www.useledgerwatch.co/login");
    expect(url.searchParams.get("return")).toBe("app");
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    expect(hash.get("n")).toBe(nonce);
    const user = await User.findOne({ email }).lean();
    expect(user).toBeTruthy();
    expect(jwt.verify(hash.get("token"), process.env.JWT_SECRET)).toMatchObject({ id: String(user._id) });
  });

  it("a sign-in started on the website still lands on the plain sign-in page", async () => {
    const email = `lw166-${Date.now()}-${++seq}@example.com`;
    stubGoogle(email);
    const { state } = await start(`n=${"b".repeat(12)}`);

    const res = await callback(`code=abc&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    expect(res.location).toMatch(/^https:\/\/www\.useledgerwatch\.co\/login#token=/);
    expect(res.location).not.toMatch(/return=app/);
  });

  it("a cancelled or expired app sign-in is reported to the app, not to the browser", async () => {
    const { state } = await start(`n=${"c".repeat(12)}&app=1`);
    const cancelled = await callback(`error=access_denied&state=${encodeURIComponent(state)}`);
    expect(cancelled.location).toMatch(/^https:\/\/www\.useledgerwatch\.co\/login\?return=app#error=/);

    const unsigned = await callback(`code=abc&state=${encodeURIComponent("1.2.3.app.deadbeef")}`);
    expect(unsigned.location).toMatch(/^https:\/\/www\.useledgerwatch\.co\/login#error=/);
  });
});
