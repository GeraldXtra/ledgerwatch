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
const { emailConfigured, emailConfigStatus, whatsappConfigStatus } = require("./notify.service");

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

const CHANNEL_NAMES = { email: "Email", whatsapp: "WhatsApp", reminder: "Reminder" };

function isCadenceSkip(delivery) {
  return delivery.status === "skipped" && /cadence window/i.test(String(delivery.error || ""));
}

function autoSendOutcome(deliveries) {
  const list = deliveries || [];
  const delivered = list.some((d) => d.status === "sent") || (list.length > 0 && list.every(isCadenceSkip));
  const notSent = list.filter((d) => d.status !== "sent" && !isCadenceSkip(d));
  return { delivered, notSent };
}

function notSentReason(d) {
  if (d.channel === "whatsapp" && d.reason === "awaiting-send") {
    return "this server cannot send WhatsApp messages by itself, so open the reminder and send it with one tap.";
  }
  return d.error || d.reason || "it was not sent";
}

function notSentText(notSent) {
  const lines = notSent.map((d) => `${CHANNEL_NAMES[d.channel] || d.channel}: ${notSentReason(d)}`);
  return `It was not sent automatically. ${lines.join(" ")}`.slice(0, 240);
}

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
    notDelivered: 0,
  };
  let reminderFailures = 0;

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
      let notSent = [];
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
            const deliveries = await dispatchReminder(result.reminder, debt, owner, { channels });
            const outcome = autoSendOutcome(deliveries);
            autoDispatched = outcome.delivered;
            notSent = outcome.notSent;
            if (!outcome.delivered) skips.notDelivered++;
            for (const d of deliveries.filter((x) => x.status === "failed")) {
              reportProblem({
                area: "reminders",
                message: `An automatic ${d.channel} reminder could not be sent: ${d.error || d.reason || "no reason given"}`,
                severity: "error",
              });
            }
          } catch (err) {
            console.error(`Automation: auto-send failed for debt ${debt._id}:`, err.message);
            notSent = [{ channel: "reminder", error: err.message }];
            skips.notDelivered++;
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
            title: notSent.length ? `Reminder not sent to ${debt.debtorName}` : `Reminder ready — ${debt.debtorName}`,
            body: notSent.length ? notSentText(notSent) : result.messageText.slice(0, 140),
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
      reminderFailures++;
      if (!(err && err.status && err.status < 500)) {
        reportProblem({
          area: "reminders",
          message: `A reminder could not be generated: ${err.message}`,
          detail: err.stack,
          severity: "error",
        });
      }
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
  if (skips.notDelivered || reminderFailures) {
    console.warn(
      `[reminders] ${skips.notDelivered} automatic reminder(s) reached nobody, so their owners were notified with the reason; ` +
        `${reminderFailures} reminder(s) could not be generated.`
    );
  }

  return { generated, debtsChecked, skips, failed: reminderFailures };
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
      remindersNotDelivered: (reminders.skips && reminders.skips.notDelivered) || 0,
      remindersFailed: reminders.failed || 0,
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
    reminderChannels: reminderChannels(),
  };
}

const EMAIL_NOT_SET_UP = "Email reminders cannot be sent automatically: email sending is not set up.";

function reminderChannels() {
  const email = emailConfigStatus();
  const whatsapp = whatsappConfigStatus();
  return {
    email: { automatic: Boolean(email.configured), reason: email.configured ? null : EMAIL_NOT_SET_UP },
    whatsapp: {
      provider: whatsapp.provider,
      automatic: Boolean(whatsapp.automatic),
      template: Boolean(whatsapp.template),
      reason: whatsapp.reason || null,
    },
  };
}

module.exports = { runAllPasses, startAutomation, getStatus, reminderChannels, autoSendOutcome };
