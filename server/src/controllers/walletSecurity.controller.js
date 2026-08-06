const bcrypt = require("bcryptjs");
const User = require("../models/User");

/**
 * OPTIONAL second factor on revealing wallet secrets.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * This is NOT password recovery and must never become it. The wallet is
 * non-custodial: the server has never held the wallet password or the keystore's
 * plaintext, so no answer given here can ever unlock a wallet on its own. The
 * password is the gate; this is an extra lock on the same door.
 *
 * Security questions are a WEAK factor — answers are often discoverable, which is
 * exactly why they are additive and opt-in rather than a replacement.
 *
 * The rate limit lives here, on the server, because that is the only place it
 * can be enforced. A counter in the browser is bypassed by anyone who opens
 * devtools. (The heavy lifting is still scrypt in the browser's keystore
 * decryption, which costs seconds per password guess by design.)
 */

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

/** A curated list plus a custom slot, so answers are not all guessable trivia. */
const PRESET_QUESTIONS = [
  { id: "first-school", prompt: "What was the name of your first school?" },
  { id: "childhood-street", prompt: "What street did you live on as a child?" },
  { id: "first-employer", prompt: "Who was your first employer?" },
  { id: "childhood-friend", prompt: "What was your childhood best friend's first name?" },
  { id: "first-pet", prompt: "What was the name of your first pet?" },
  { id: "memorable-teacher", prompt: "Which teacher do you remember most?" },
];

/** Answers compare case- and space-insensitively; people do not retype exactly. */
function normalizeAnswer(a) {
  return String(a || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// GET /api/wallet/security — prompts only, NEVER the hashes.
async function get(req, res) {
  try {
    const user = await User.findById(req.user._id).select("walletSecurity").lean();
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

// PUT /api/wallet/security  { enabled, answers: [{id, prompt, answer}] }
async function set(req, res) {
  try {
    const { enabled, answers } = req.body || {};

    if (!enabled) {
      await User.updateOne(
        { _id: req.user._id },
        { $set: { "walletSecurity.enabled": false, "walletSecurity.questions": [] } }
      );
      return res.json({ enabled: false, questions: [] });
    }

    if (!Array.isArray(answers) || answers.length < 3) {
      return res.status(400).json({ error: "Choose at least three questions and answer each." });
    }
    for (const a of answers) {
      if (!a || !a.id || !a.prompt || normalizeAnswer(a.answer).length < 2) {
        return res.status(400).json({ error: "Every question needs an answer of at least two characters." });
      }
    }

    // Hashed one at a time; the plaintext is never assembled into a log line.
    const questions = [];
    for (const a of answers) {
      questions.push({
        id: String(a.id),
        prompt: String(a.prompt).slice(0, 200),
        answerHash: await bcrypt.hash(normalizeAnswer(a.answer), 10),
      });
    }

    await User.updateOne(
      { _id: req.user._id },
      {
        $set: {
          "walletSecurity.enabled": true,
          "walletSecurity.questions": questions,
          "walletSecurity.failedAttempts": 0,
          "walletSecurity.lockedUntil": null,
        },
      }
    );
    return res.json({ enabled: true, questions: questions.map((q) => ({ id: q.id, prompt: q.prompt })) });
  } catch (err) {
    console.error("wallet security set error:", err.message);
    return res.status(500).json({ error: "Could not save your verification settings." });
  }
}

// POST /api/wallet/security/verify  { answers: [{id, answer}] }
async function verify(req, res) {
  try {
    const user = await User.findById(req.user._id).select("walletSecurity");
    const sec = (user && user.walletSecurity) || {};

    // Not enabled: nothing to check. Says so rather than silently passing, so a
    // caller can tell "verified" apart from "there was no second factor".
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

    const supplied = Array.isArray(req.body && req.body.answers) ? req.body.answers : [];

    // EVERY question must match. Compared with bcrypt, and all of them are
    // checked even after a mismatch so the response time does not reveal which
    // one was wrong.
    let allMatch = supplied.length === sec.questions.length;
    for (const q of sec.questions) {
      const given = supplied.find((s) => s && s.id === q.id);
      const ok = given ? await bcrypt.compare(normalizeAnswer(given.answer), q.answerHash) : false;
      if (!ok) allMatch = false;
    }

    if (!allMatch) {
      const failed = (sec.failedAttempts || 0) + 1;
      const locked = failed >= MAX_ATTEMPTS;
      await User.updateOne(
        { _id: req.user._id },
        {
          $set: {
            "walletSecurity.failedAttempts": locked ? 0 : failed,
            "walletSecurity.lockedUntil": locked
              ? new Date(Date.now() + LOCK_MINUTES * 60000)
              : null,
          },
        }
      );
      return res.status(locked ? 429 : 401).json({
        verified: false,
        error: locked
          ? `Too many incorrect attempts. Locked for ${LOCK_MINUTES} minutes.`
          : `Those answers do not match. ${MAX_ATTEMPTS - failed} attempt${
              MAX_ATTEMPTS - failed === 1 ? "" : "s"
            } left.`,
      });
    }

    await User.updateOne(
      { _id: req.user._id },
      { $set: { "walletSecurity.failedAttempts": 0, "walletSecurity.lockedUntil": null } }
    );
    return res.json({ verified: true });
  } catch (err) {
    console.error("wallet security verify error:", err.message);
    return res.status(500).json({ error: "Could not verify your answers." });
  }
}

module.exports = { get, set, verify, PRESET_QUESTIONS };
