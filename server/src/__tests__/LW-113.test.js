/**
 * LW-113 — a bucket must be pruned with ITS OWN window, not the caller's.
 *
 * THE DEFECT. `prune(now, windowMs)` took the window from whichever limiter
 * happened to trigger it and applied it to EVERY bucket in the shared map.
 * Windows here range from one minute (`rpcProxy`, `btc-broadcast`) to sixty
 * (`mailSend`, `allocate`).
 *
 * WHY IT WAS WORSE THAN AN ATTACK. Buckets were never expired anywhere else, so
 * the map only ever grew — every distinct IP that hits an auth route, plus every
 * user id. A real deployment reaches 50,000 keys on its own. From that moment
 * every request prunes the whole map, and because the shortest windows are also
 * the highest-frequency callers, the effective retention for ALL buckets
 * collapsed to about sixty seconds. The fifteen-minute cap on sign-in attempts
 * and the hour-long caps on sending email and issuing payment addresses quietly
 * became sixty-second caps, with nothing logged.
 *
 * The test below is the reproduction that found it, run against the fix.
 */

const { rateLimit } = require("../middleware/rateLimit");

/** A minimal Express-shaped request/response pair. */
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
    // A controlled clock. The defect needs elapsed time to show itself: the
    // victim's hits have to be older than the SHORT window and younger than
    // their own long one, which is exactly the window the bug misapplied.
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
    // Effectively unlimited: this one exists only to fill the shared map.
    const minutely = rateLimit({
      windowMs: 60 * 1000,
      max: Number.MAX_SAFE_INTEGER,
      name: "lw113-rpc",
      byUser: true,
    });

    const victim = mkReq("lw113-victim");

    // Spend the hourly allowance.
    expect(hit(hourly, victim)).toBe(true);
    expect(hit(hourly, victim)).toBe(true);
    expect(hit(hourly, victim)).toBe(true);
    expect(hit(hourly, victim)).toBe(false);

    // Five minutes on: outside the one-minute window, well inside the hour.
    offset = 5 * 60 * 1000;
    expect(hit(hourly, victim), "still inside its own hour").toBe(false);

    // Push the SHARED map past MAX_KEYS so the next request prunes everything.
    // This is the step that used to hand the allowance back.
    for (let i = 0; i < 50001; i++) {
      minutely(mkReq(`lw113-filler-${i}`), mkRes(), () => {});
    }

    // The assertion the defect was about. Before the fix these were all allowed.
    expect(hit(hourly, victim), "the hour has not passed").toBe(false);
    expect(hit(hourly, victim)).toBe(false);
    expect(hit(hourly, victim)).toBe(false);
  });

  it("still releases a bucket once its own window really has passed", () => {
    // The other half: the fix must not make limits permanent.
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

    offset = 61 * 60 * 1000; // past the hour
    expect(hit(hourly, req), "the window has genuinely elapsed").toBe(true);
  });

  it("keeps two limiters' budgets independent of one another", () => {
    // A bucket key begins with the limiter's name, so spending one must not
    // touch the other even for the same caller.
    const a = rateLimit({ windowMs: 60 * 1000, max: 1, name: "lw113-a", byUser: true });
    const b = rateLimit({ windowMs: 60 * 1000, max: 1, name: "lw113-b", byUser: true });
    const req = mkReq("lw113-shared-user");

    expect(hit(a, req)).toBe(true);
    expect(hit(a, req)).toBe(false);
    expect(hit(b, req), "b has its own allowance").toBe(true);
    expect(hit(b, req)).toBe(false);
  });
});
