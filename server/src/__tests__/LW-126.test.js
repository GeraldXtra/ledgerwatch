const User = require("../models/User");
const { updateMe } = require("../controllers/auth.controller");

let seq = 0;
const anEmail = () => `lw126-${Date.now()}-${++seq}@example.com`;

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}

async function save(user, notifyPrefs) {
  const res = mockRes();
  await updateMe({ user, body: { notifyPrefs } }, res);
  return { res, stored: (await User.findById(user._id).lean()).notifyPrefs };
}

describe("LW-126 — saving one notification choice never resets the others", () => {
  it("changes only the choice that was sent", async () => {
    const user = await User.create({ name: "P", email: anEmail(), passwordHash: "x" });
    const { res, stored } = await save(user, { trades: false });
    expect(res.statusCode).toBe(200);
    expect(stored).toMatchObject({ trades: false, moneyIn: true, profit: true, marketAlerts: true, emailActivity: true });
  });

  it("keeps a newer choice when an older page sends only the three original keys", async () => {
    const user = await User.create({ name: "P", email: anEmail(), passwordHash: "x", notifyPrefs: { moneyIn: false, emailActivity: false } });
    const { stored } = await save(user, { marketAlerts: true, remindersDue: false, txUpdates: true });
    expect(stored).toMatchObject({ moneyIn: false, emailActivity: false, remindersDue: false });
  });

  it("ignores keys it does not know, so nothing else can be written through this field", async () => {
    const user = await User.create({ name: "P", email: anEmail(), passwordHash: "x" });
    const { stored } = await save(user, { "$where": "1", tokenVersion: 99, profit: false });
    expect(stored.profit).toBe(false);
    expect(stored.$where).toBeUndefined();
    expect((await User.findById(user._id).lean()).tokenVersion || 0).toBe(0);
  });

  it("reports every choice to the browser, defaulting to on", async () => {
    const user = await User.create({ name: "P", email: anEmail(), passwordHash: "x" });
    const { res } = await save(user, { profit: false });
    expect(res.body.user.notifyPrefs).toEqual({
      marketAlerts: true,
      remindersDue: true,
      txUpdates: true,
      moneyIn: true,
      trades: true,
      profit: false,
      emailActivity: true,
    });
  });
});
