const Debt = require("../models/Debt");
const User = require("../models/User");
const {
  generateReminderForDebt,
  dispatchReminder,
  DAY_MS,
} = require("./reminder.service");
const { runPricePass } = require("./market.service");
const { notifyUser, signActionToken } = require("./push.service");

const DEFAULT_INTERVAL_MS = 60000; // 60s for demo

// Module-level state, exposed via getStatus() for the /status route.
const state = {
  active: false,
  intervalMs: DEFAULT_INTERVAL_MS,
  isRunning: false,
  lastRunAt: null,
  lastGenerated: null,
  lastDebtsChecked: null,
  lastAlertsCreated: null,
  lastWatchesChecked: null,
};

let intervalHandle = null;

/**
 * Section 4 REMINDER PASS (no overlap guard — called under runAllPasses' guard).
 * Finds pending debts that are due and past their cadence window, and generates
 * a reminder for each via the shared engine. Each debt is wrapped in try/catch.
 * @returns {Promise<{ generated:number, debtsChecked:number }>}
 */
async function doReminderPass({ userId } = {}) {
  const now = Date.now();
  // Remind debts that are still owed — pending OR partially paid — and past due.
  const query = {
    status: { $in: ["pending", "partially_paid"] },
    dueDate: { $lte: new Date(now) },
  };
  if (userId) query.userId = userId;

  const candidates = await Debt.find(query);
  const debtsChecked = candidates.length;
  let generated = 0;

  // Cache users within a pass so we don't refetch the same owner repeatedly.
  const userCache = new Map();

  for (const debt of candidates) {
    // Per-debt cadence guard (reminderCadenceDays varies per debt).
    const cadenceMs = (debt.reminderCadenceDays || 3) * DAY_MS;
    const eligible =
      !debt.lastRemindedAt ||
      now - new Date(debt.lastRemindedAt).getTime() >= cadenceMs;
    if (!eligible) continue;

    try {
      const key = String(debt.userId);
      let owner = userCache.get(key);
      if (owner === undefined) {
        owner = await User.findById(debt.userId).select("-passwordHash");
        userCache.set(key, owner);
      }
      if (!owner) continue; // orphaned debt — skip, don't crash

      const result = await generateReminderForDebt(debt, owner);
      generated++;

      // Opt-in auto-send: dispatch through the owner's enabled channels. Default is
      // OFF, so absent config means we only GENERATE (as before). dispatchReminder is
      // idempotent within the cadence window and degrades gracefully when a provider
      // is unconfigured, so this never throws the pass.
      const autoSend = owner.autoSend || {};
      let autoDispatched = false;
      if (autoSend.enabled) {
        const channels = [];
        if (autoSend.whatsapp && debt.debtorPhone) channels.push("whatsapp");
        if (autoSend.email && debt.debtorEmail) channels.push("email");
        if (channels.length) {
          try {
            await dispatchReminder(result.reminder, debt, owner, { channels });
            autoDispatched = true;
          } catch (err) {
            console.error(`Automation: auto-send failed for debt ${debt._id}:`, err.message);
          }
        }
      }

      // Actionable push when the human still has to act (auto-send OFF). The payload
      // carries per-action tokens so the notification buttons can call the server.
      // No-ops when push is unconfigured.
      if (!autoDispatched) {
        try {
          const tokens = {};
          if (debt.debtorPhone) tokens.send_whatsapp = signActionToken(owner._id, "send_whatsapp", debt._id);
          if (debt.debtorEmail) tokens.send_email = signActionToken(owner._id, "send_email", debt._id);
          const actions = [];
          if (tokens.send_whatsapp) actions.push({ action: "send_whatsapp", title: "WhatsApp" });
          if (tokens.send_email) actions.push({ action: "send_email", title: "Email" });
          actions.push({ action: "dismiss", title: "Dismiss" });

          await notifyUser(owner._id, {
            title: `Reminder ready — ${debt.debtorName}`,
            body: result.messageText.slice(0, 140),
            tag: `reminder-${debt._id}`,
            type: "reminder",
            url: "/app",
            actions,
            tokens,
          });
        } catch (err) {
          console.error(`Automation: reminder push failed for debt ${debt._id}:`, err.message);
        }
      }
    } catch (err) {
      console.error(`Automation: failed to remind debt ${debt._id}:`, err.message);
      // continue to the next debt
    }
  }

  return { generated, debtsChecked };
}

/**
 * Run BOTH the reminder pass and the price pass under a single overlap guard.
 * @param {{ userId?: string }} [opts]
 * @returns {Promise<{ generated:number, debtsChecked:number, alertsCreated:number, watchesChecked:number, skipped?:boolean }>}
 */
async function runAllPasses({ userId } = {}) {
  if (state.isRunning) {
    return {
      skipped: true,
      generated: 0,
      debtsChecked: 0,
      alertsCreated: 0,
      watchesChecked: 0,
    };
  }
  state.isRunning = true;

  try {
    // Reminder pass — never lets the whole run die.
    let reminders = { generated: 0, debtsChecked: 0 };
    try {
      reminders = await doReminderPass({ userId });
    } catch (err) {
      console.error("Automation: reminder pass error:", err.message);
    }

    // Price pass (section 4) — runPricePass guards each watch internally.
    let prices = { alertsCreated: 0, watchesChecked: 0 };
    try {
      prices = await runPricePass({ userId });
    } catch (err) {
      console.error("Automation: price pass error:", err.message);
    }

    state.lastRunAt = new Date();
    state.lastGenerated = reminders.generated;
    state.lastDebtsChecked = reminders.debtsChecked;
    state.lastAlertsCreated = prices.alertsCreated;
    state.lastWatchesChecked = prices.watchesChecked;

    return {
      generated: reminders.generated,
      debtsChecked: reminders.debtsChecked,
      alertsCreated: prices.alertsCreated,
      watchesChecked: prices.watchesChecked,
    };
  } finally {
    state.isRunning = false;
  }
}

/**
 * Start the background interval. Must be called AFTER the DB is connected.
 */
function startAutomation() {
  state.intervalMs = Number(process.env.AUTOMATION_INTERVAL_MS) || DEFAULT_INTERVAL_MS;

  if (intervalHandle) clearInterval(intervalHandle);

  intervalHandle = setInterval(async () => {
    try {
      const result = await runAllPasses();
      if (result.skipped) {
        console.log("Automation: pass skipped (previous pass still running)");
      } else {
        console.log(
          `Automation: reminder pass — generated ${result.generated} (checked ${result.debtsChecked}); ` +
            `price pass — alerts ${result.alertsCreated} (watches ${result.watchesChecked})`
        );
      }
    } catch (err) {
      // runAllPasses shouldn't throw, but never let the interval die.
      console.error("Automation: pass error:", err.message);
    }
  }, state.intervalMs);

  // Don't keep the event loop alive solely for this timer.
  if (typeof intervalHandle.unref === "function") intervalHandle.unref();

  state.active = true;
  console.log(`Automation: loop started (every ${state.intervalMs}ms)`);
}

function getStatus() {
  return {
    active: state.active,
    intervalMs: state.intervalMs,
    isRunning: state.isRunning,
    lastRunAt: state.lastRunAt,
    lastGenerated: state.lastGenerated,
    lastDebtsChecked: state.lastDebtsChecked,
    lastAlertsCreated: state.lastAlertsCreated,
    lastWatchesChecked: state.lastWatchesChecked,
  };
}

module.exports = { runAllPasses, startAutomation, getStatus };
