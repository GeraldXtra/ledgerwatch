const { rateLimit } = require("../middleware/rateLimit");

const mkReq = (id) => ({
  user: { _id: id },
  ip: "1.1.1.1",
  socket: { remoteAddress: "1.1.1.1" },
  body: {},
});

function mkRes() {
  const r = {
    code: 0,
    body: null,
    setHeader() {},
    status(c) {
      r.code = c;
      return r;
    },
    json(b) {
      r.body = b;
      return r;
    },
  };
  return r;
}

function hit(limiter, req) {
  const res = mkRes();
  let passed = false;
  limiter(req, res, () => {
    passed = true;
  });
  return passed;
}

describe("LW-113 — cross-window prune", () => {
  let realNow;
  let offset;

  beforeEach(() => {
    realNow = Date.now;
    offset = 0;
    Date.now = () => realNow.call(Date) + offset;
  });

  afterEach(() => {
    Date.now = realNow;
  });

  it("does not reset an hour-long limit when a one-minute limiter forces a sweep", () => {
    const hourly = rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 3,
      name: "lw113-allocate",
      byUser: true,
    });
    const minutely = rateLimit({
      windowMs: 60 * 1000,
      max: Number.MAX_SAFE_INTEGER,
      name: "lw113-rpc",
      byUser: true,
    });

    const victim = mkReq("lw113-victim");

    expect(hit(hourly, victim)).toBe(true);
    expect(hit(hourly, victim)).toBe(true);
    expect(hit(hourly, victim)).toBe(true);
    expect(hit(hourly, victim)).toBe(false);

    offset = 5 * 60 * 1000;
    expect(hit(hourly, victim), "still inside its own hour").toBe(false);

    for (let i = 0; i < 50001; i++) {
      minutely(mkReq(`lw113-filler-${i}`), mkRes(), () => {});
    }

    expect(hit(hourly, victim), "the hour has not passed").toBe(false);
    expect(hit(hourly, victim)).toBe(false);
    expect(hit(hourly, victim)).toBe(false);
  });

  it("still releases a bucket once its own window really has passed", () => {
    const hourly = rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 2,
      name: "lw113-release",
      byUser: true,
    });
    const req = mkReq("lw113-release-user");

    expect(hit(hourly, req)).toBe(true);
    expect(hit(hourly, req)).toBe(true);
    expect(hit(hourly, req)).toBe(false);

    offset = 61 * 60 * 1000;
    expect(hit(hourly, req), "the window has genuinely elapsed").toBe(true);
  });

  it("keeps two limiters' budgets independent of one another", () => {
    const a = rateLimit({ windowMs: 60 * 1000, max: 1, name: "lw113-a", byUser: true });
    const b = rateLimit({ windowMs: 60 * 1000, max: 1, name: "lw113-b", byUser: true });
    const req = mkReq("lw113-shared-user");

    expect(hit(a, req)).toBe(true);
    expect(hit(a, req)).toBe(false);
    expect(hit(b, req), "b has its own allowance").toBe(true);
    expect(hit(b, req)).toBe(false);
  });
});
