const bcrypt = require("bcryptjs");
const { scopedRepo } = require("../repositories/scoped");

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const MAX_QUESTIONS = 6;

const PRESET_QUESTIONS = [
  { id: "first-school", prompt: "What was the name of your first school?" },
  { id: "childhood-street", prompt: "What street did you live on as a child?" },
  { id: "first-employer", prompt: "Who was your first employer?" },
  { id: "childhood-friend", prompt: "What was your childhood best friend's first name?" },
  { id: "first-pet", prompt: "What was the name of your first pet?" },
  { id: "memorable-teacher", prompt: "Which teacher do you remember most?" },
];

function normalizeAnswer(a) {
  return String(a || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function get(req, res) {
  try {
    const user = await scopedRepo(req.user._id).self.get("walletSecurity").lean();
    const sec = (user && user.walletSecurity) || {};
    return res.json({
      enabled: Boolean(sec.enabled),
      questions: (sec.questions || []).map((q) => ({ id: q.id, prompt: q.prompt })),
      presets: PRESET_QUESTIONS,
      lockedUntil: sec.lockedUntil || null,
    });
  } catch (err) {
    console.error("wallet security get error:", err.message);
    return res.status(500).json({ error: "Could not load your verification settings." });
  }
}

async function announceChange(userId, event) {
  console.warn(
    `[wallet-security] ${event} user=${userId} at=${new Date().toISOString()}`
  );
  try {

    const { notifyUser } = require("../services/push.service");
    await notifyUser(userId, {
      title: "Wallet verification changed",
      body:
        event === "disabled"
          ? "The security questions on your wallet were switched off. If that was not you, change your password now."
          : "The security questions on your wallet were replaced. If that was not you, change your password now.",
      tag: "wallet-security",
      type: "security",
      url: "/app/settings",
    });
  } catch (err) {
    console.error("[wallet-security] could not notify the owner:", err.message);
  }
}

async function set(req, res) {
  try {
    const { enabled, answers } = req.body;
    const self = scopedRepo(req.user._id).self;

    const before = await self.get("walletSecurity.enabled").lean();
    const wasEnabled = Boolean(before && before.walletSecurity && before.walletSecurity.enabled);

    if (!enabled) {
      await self.updateOne({ $set: { "walletSecurity.enabled": false, "walletSecurity.questions": [] } });
      if (wasEnabled) await announceChange(req.user._id, "disabled");
      return res.json({ enabled: false, questions: [] });
    }

    if (!Array.isArray(answers) || answers.length < 3) {
      return res.status(400).json({ error: "Choose at least three questions and answer each." });
    }
    if (answers.length > MAX_QUESTIONS) {
      return res.status(400).json({ error: `Choose at most ${MAX_QUESTIONS} questions.` });
    }
    for (const a of answers) {
      if (!a || !a.id || !a.prompt || normalizeAnswer(a.answer).length < 2) {
        return res.status(400).json({ error: "Every question needs an answer of at least two characters." });
      }
      if (String(a.id).length > 64 || normalizeAnswer(a.answer).length > 200) {
        return res.status(400).json({ error: "An answer must be 200 characters or fewer." });
      }
    }

    const questions = [];
    for (const a of answers) {
      questions.push({
        id: String(a.id),
        prompt: String(a.prompt).slice(0, 200),
        answerHash: await bcrypt.hash(normalizeAnswer(a.answer), 10),
      });
    }

    await self.updateOne(
      {
        $set: {
          "walletSecurity.enabled": true,
          "walletSecurity.questions": questions,
          "walletSecurity.failedAttempts": 0,
          "walletSecurity.lockedUntil": null,
        },
      }
    );
    if (wasEnabled) await announceChange(req.user._id, "replaced");
    return res.json({ enabled: true, questions: questions.map((q) => ({ id: q.id, prompt: q.prompt })) });
  } catch (err) {
    console.error("wallet security set error:", err.message);
    return res.status(500).json({ error: "Could not save your verification settings." });
  }
}

async function verify(req, res) {
  try {
    const self = scopedRepo(req.user._id).self;
    const user = await self.get("walletSecurity");
    const sec = (user && user.walletSecurity) || {};

    if (!sec.enabled || !(sec.questions || []).length) {
      return res.json({ verified: true, skipped: true });
    }

    if (sec.lockedUntil && new Date(sec.lockedUntil) > new Date()) {
      const mins = Math.ceil((new Date(sec.lockedUntil) - Date.now()) / 60000);
      return res.status(429).json({
        verified: false,
        error: `Too many incorrect attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
      });
    }

    const supplied = Array.isArray(req.body.answers) ? req.body.answers.slice(0, MAX_QUESTIONS) : [];

    let allMatch = supplied.length === sec.questions.length;
    for (const q of sec.questions) {
      const given = supplied.find((s) => s && s.id === q.id);
      const ok = given ? await bcrypt.compare(normalizeAnswer(given.answer), q.answerHash) : false;
      if (!ok) allMatch = false;
    }

    if (!allMatch) {
      const failed = (sec.failedAttempts || 0) + 1;
      const locked = failed >= MAX_ATTEMPTS;
      await self.updateOne(
        {
          $set: {
            "walletSecurity.failedAttempts": locked ? 0 : failed,
            "walletSecurity.lockedUntil": locked
              ? new Date(Date.now() + LOCK_MINUTES * 60000)
              : null,
          },
        }
      );
      return res.status(locked ? 429 : 403).json({
        verified: false,
        error: locked
          ? `Too many incorrect attempts. Locked for ${LOCK_MINUTES} minutes.`
          : `Those answers do not match. ${MAX_ATTEMPTS - failed} attempt${
              MAX_ATTEMPTS - failed === 1 ? "" : "s"
            } left.`,
      });
    }

    await self.updateOne({ $set: { "walletSecurity.failedAttempts": 0, "walletSecurity.lockedUntil": null } });
    return res.json({ verified: true });
  } catch (err) {
    console.error("wallet security verify error:", err.message);
    return res.status(500).json({ error: "Could not verify your answers." });
  }
}

module.exports = { get, set, verify, PRESET_QUESTIONS };
