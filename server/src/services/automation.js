const Debt = require("../models/Debt");
const User = require("../models/User");
const {
  generateReminderForDebt,
  dispatchReminder,
  DAY_MS,
} = require("./reminder.service");
const { runPricePass } = require("./market.service");
const { reportProblem } = require("./opsAlert.service");
const { runPaymentWatchPass } = require("./paymentWatch.service");
const { notifyUser, signActionToken } = require("./push.service");
const { emailConfigured } = require("./notify.service");

const DEFAULT_INTERVAL_MS = 60000;

const state = {
  active: false,
  intervalMs: DEFAULT_INTERVAL_MS,
  isRunning: false,
  lastRunAt: null,
  lastGenerated: null,
  lastDebtsChecked: null,
  lastAlertsCreated: null,
  lastWatchesChecked: null,
  lastWatchesDeferred: null,
  lastAddressesChecked: null,
  lastPaymentsDetected: null,
  lastPaymentsSettled: null,
  lastWalletTxsSettled: null,
  lastInboundAnnounced: null,
  lastPassMs: null,
};

let intervalHandle = null;

async function doReminderPass({ userId } = {}) {
  const now = Date.now();
  const query = {
    status: { $in: ["pending", "partially_paid"] },
    dueDate: { $lte: new Date(now) },
  };
  if (userId) query.userId = userId;

  const candidates = await Debt.find(query);
  const debtsChecked = candidates.length;
  let generated = 0;

  const skips = {
    notDueYet: 0,
    cadenceNotElapsed: 0,
    ownerMissing: 0,
    autoSendOff: 0,
    emailChannelOff: 0,
    noEmailAddress: 0,
    emailNotConfigured: 0,
  };

  const notDueQuery = { status: { $in: ["pending", "partially_paid"] }, dueDate: { $gt: new Date(now) } };
  if (userId) notDueQuery.userId = userId;
  skips.notDueYet = await Debt.countDocuments(notDueQuery);

  const userCache = new Map();

  for (const debt of candidates) {
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
        continue;
      }

      const result = await generateReminderForDebt(debt, owner);
      generated++;

      const autoSend = owner.autoSend || {};
      let autoDispatched = false;
      if (!autoSend.enabled) {
        skips.autoSendOff++;
      } else {
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
    }
  }

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
  const startedAt = Date.now();

  try {
    let reminders = { generated: 0, debtsChecked: 0 };
    try {
      reminders = await doReminderPass({ userId });
    } catch (err) {
      console.error("Automation: reminder pass error:", err.message);
      reportProblem({ area: "reminders", message: `The reminder pass failed: ${err.message}`, detail: err.stack, severity: "error" });
    }

    let prices = { alertsCreated: 0, watchesChecked: 0, watchesDeferred: 0 };
    try {
      prices = await runPricePass({ userId });
    } catch (err) {
      console.error("Automation: price pass error:", err.message);
      reportProblem({ area: "price alerts", message: `The price pass failed: ${err.message}`, detail: err.stack, severity: "error" });
    }

    let payments = { addressesChecked: 0, detected: 0, confirmed: 0, settled: 0 };
    try {
      payments = await runPaymentWatchPass({ userId });
    } catch (err) {
      console.error("Automation: payment watch pass error:", err.message);
      reportProblem({ area: "payment watching", message: `The payment watch pass failed: ${err.message}`, detail: err.stack, severity: "critical" });
    }

    let walletTxs = { checked: 0, settled: 0 };
    let inbound = { checked: 0, announced: 0, deferred: 0 };
    try {
      const walletActivity = require("./walletActivity.service");
      walletTxs = await walletActivity.runWalletTxPass({ userId });
      inbound = await walletActivity.runInboundPass({ userId });
      const chains = await walletActivity.runChainWatchPass({ userId });
      inbound.announced += chains.announced;
    } catch (err) {
      console.error("Automation: wallet activity pass error:", err.message);
      reportProblem({ area: "wallet activity", message: `The wallet activity pass failed: ${err.message}`, detail: err.stack, severity: "error" });
    }

    state.lastRunAt = new Date();
    state.lastGenerated = reminders.generated;
    state.lastDebtsChecked = reminders.debtsChecked;
    state.lastAlertsCreated = prices.alertsCreated;
    state.lastWatchesChecked = prices.watchesChecked;
    state.lastWatchesDeferred = prices.watchesDeferred;
    state.lastPaymentsSettled = payments.settled;
    state.lastPaymentsDetected = payments.detected;
    state.lastAddressesChecked = payments.addressesChecked;
    state.lastWalletTxsSettled = walletTxs.settled;
    state.lastInboundAnnounced = inbound.announced;
    state.lastPassMs = Date.now() - startedAt;

    if (state.intervalMs && state.lastPassMs > state.intervalMs) {
      console.warn(
        `Automation: pass took ${Math.round(state.lastPassMs / 1000)}s, longer than the ` +
          `${Math.round(state.intervalMs / 1000)}s interval. Ticks in the meantime were skipped ` +
          `by the overlap guard, so no reminders were sent and no payments were detected while ` +
          `it ran.`
      );
    }

    return {
      generated: reminders.generated,
      debtsChecked: reminders.debtsChecked,
      alertsCreated: prices.alertsCreated,
      watchesChecked: prices.watchesChecked,
      watchesDeferred: prices.watchesDeferred,
      addressesChecked: payments.addressesChecked,
      paymentsDetected: payments.detected,
      paymentsConfirmed: payments.confirmed,
      paymentsSettled: payments.settled,
    };
  } finally {
    state.isRunning = false;
  }
}

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
            `price pass — alerts ${result.alertsCreated} (watches ${result.watchesChecked}` +
            `${result.watchesDeferred ? `, ${result.watchesDeferred} deferred` : ""}); ` +
            `payment pass — addresses ${result.addressesChecked}, detected ${result.paymentsDetected}, ` +
            `confirmed ${result.paymentsConfirmed}, settled ${result.paymentsSettled}`
        );
      }
    } catch (err) {
      console.error("Automation: pass error:", err.message);
    }
  }, state.intervalMs);

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
    lastWatchesDeferred: state.lastWatchesDeferred,
    lastAddressesChecked: state.lastAddressesChecked,
    lastPaymentsDetected: state.lastPaymentsDetected,
    lastPaymentsSettled: state.lastPaymentsSettled,
    lastWalletTxsSettled: state.lastWalletTxsSettled,
    lastInboundAnnounced: state.lastInboundAnnounced,
    lastPassMs: state.lastPassMs,
  };
}

module.exports = { runAllPasses, startAutomation, getStatus };
