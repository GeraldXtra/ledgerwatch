const Debt = require("../models/Debt");
const User = require("../models/User");
const {
  generateReminderForDebt,
  dispatchReminder,
  DAY_MS,
} = require("./reminder.service");
const { runPricePass } = require("./market.service");
const { runPaymentWatchPass } = require("./paymentWatch.service");
const { notifyUser, signActionToken } = require("./push.service");
const { emailConfigured } = require("./notify.service");

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

  /**
   * WHY NOTHING WAS SENT.
   *
   * This pass used to report only `generated` and `debtsChecked`, so "the agent
   * is not sending my reminders" had no answer short of reading the source. There
   * are six independent reasons a debt produces no email, and five of them are
   * configuration rather than failure, so nothing errors and nothing is logged.
   * Counting them is the difference between a silent no-op and a sentence that
   * names the fix.
   */
  const skips = {
    notDueYet: 0, // due date is in the future — excluded by the query above
    cadenceNotElapsed: 0, // reminded too recently for this debt's cadence
    ownerMissing: 0,
    autoSendOff: 0, // owner has not enabled automatic sending
    emailChannelOff: 0, // autoSend on, but the email channel is not enabled
    noEmailAddress: 0, // nothing to send to
    emailNotConfigured: 0, // SMTP missing on the server
  };

  // Counted separately because the query already filtered them out: a user who
  // just added a debtor due next week sees no activity and assumes it is broken.
  const notDueQuery = { status: { $in: ["pending", "partially_paid"] }, dueDate: { $gt: new Date(now) } };
  if (userId) notDueQuery.userId = userId;
  skips.notDueYet = await Debt.countDocuments(notDueQuery);

  // Cache users within a pass so we don't refetch the same owner repeatedly.
  const userCache = new Map();

  for (const debt of candidates) {
    // Per-debt cadence guard (reminderCadenceDays varies per debt).
    const cadenceMs = (debt.reminderCadenceDays || 3) * DAY_MS;
    const eligible =
      !debt.lastRemindedAt ||
      now - new Date(debt.lastRemindedAt).getTime() >= cadenceMs;
    if (!eligible) {
      skips.cadenceNotElapsed++;
      continue;
    }

    try {
      const key = String(debt.userId);
      let owner = userCache.get(key);
      if (owner === undefined) {
        owner = await User.findById(debt.userId).select("-passwordHash");
        userCache.set(key, owner);
      }
      if (!owner) {
        skips.ownerMissing++;
        continue; // orphaned debt — skip, don't crash
      }

      const result = await generateReminderForDebt(debt, owner);
      generated++;

      // Opt-in auto-send: dispatch through the owner's enabled channels. Default is
      // OFF, so absent config means we only GENERATE (as before). dispatchReminder is
      // idempotent within the cadence window and degrades gracefully when a provider
      // is unconfigured, so this never throws the pass.
      const autoSend = owner.autoSend || {};
      let autoDispatched = false;
      if (!autoSend.enabled) {
        skips.autoSendOff++;
      } else {
        // Tally the email path specifically. WhatsApp has a manual fallback that
        // always works; email has none, so a silent skip there is the one people
        // actually notice and cannot explain.
        if (!autoSend.email) skips.emailChannelOff++;
        else if (!debt.debtorEmail) skips.noEmailAddress++;
        else if (!emailConfigured()) skips.emailNotConfigured++;

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

  /**
   * Say why, in one line, when a pass generates reminders but emails none of
   * them. Ordered by how often each one is the real answer, and only the top
   * blocker is printed so the log stays readable on a 60 second timer.
   */
  if (debtsChecked > 0 && generated > 0) {
    const why =
      (skips.emailNotConfigured && `SMTP is not configured on the server, so ${skips.emailNotConfigured} email(s) were skipped`) ||
      (skips.autoSendOff && `${skips.autoSendOff} owner(s) have automatic sending switched OFF (Settings > Notifications), so a push was sent instead of an email`) ||
      (skips.emailChannelOff && `${skips.emailChannelOff} owner(s) have automatic sending on but the EMAIL channel off`) ||
      (skips.noEmailAddress && `${skips.noEmailAddress} debtor(s) have no email address on file`) ||
      null;
    if (why) console.log(`[reminders] generated ${generated}, emailed 0 - ${why}.`);
  } else if (debtsChecked === 0 && skips.notDueYet > 0) {
    console.log(
      `[reminders] nothing to do: 0 debts are past due. ${skips.notDueYet} debt(s) exist but are not due yet - ` +
        `reminders start on the due date and then repeat every "Re-remind every (days)" days.`
    );
  } else if (debtsChecked > 0 && generated === 0 && skips.cadenceNotElapsed === debtsChecked) {
    console.log(
      `[reminders] nothing to do: all ${debtsChecked} overdue debt(s) were reminded too recently for their cadence.`
    );
  }

  return { generated, debtsChecked, skips };
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

    // Payment watch pass — inbound stablecoin transfers to invoice addresses.
    // Deliberately a third pass inside THIS loop rather than a second interval,
    // so it shares the overlap guard and fires from the manual trigger too.
    let payments = { addressesChecked: 0, detected: 0, confirmed: 0, settled: 0 };
    try {
      payments = await runPaymentWatchPass({ userId });
    } catch (err) {
      console.error("Automation: payment watch pass error:", err.message);
    }

    state.lastRunAt = new Date();
    state.lastGenerated = reminders.generated;
    state.lastDebtsChecked = reminders.debtsChecked;
    state.lastAlertsCreated = prices.alertsCreated;
    state.lastWatchesChecked = prices.watchesChecked;
    state.lastPaymentsSettled = payments.settled;
    state.lastAddressesChecked = payments.addressesChecked;

    return {
      generated: reminders.generated,
      debtsChecked: reminders.debtsChecked,
      alertsCreated: prices.alertsCreated,
      watchesChecked: prices.watchesChecked,
      addressesChecked: payments.addressesChecked,
      paymentsDetected: payments.detected,
      paymentsConfirmed: payments.confirmed,
      paymentsSettled: payments.settled,
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
