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
const MAX_QUESTIONS = 6;

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

/**
 * TURNING THE SECOND LOCK OFF, OR REPLACING IT, IS AN EVENT SOMEBODY MUST HEAR
 * ABOUT.
 *
 * It used to happen in total silence: one request from any signed-in session
 * cleared the questions, with no existing answer given, no password re-entered
 * and nothing written anywhere. A person whose session had been taken would
 * find their questions simply gone, with no explanation and no timestamp, which
 * is the shape of an incident nobody can reconstruct afterwards.
 *
 * This does not make the control unremovable — that needs proof of the existing
 * factor, and the settings panel does not collect one yet (see the note in the
 * report accompanying this change). What it does is make the removal audible:
 * a structured line in the log, which SECURITY.md 4.3 SHOULD 6 asks for, and a
 * push to the owner's devices, which is the only channel that reaches a person
 * who is not the one making the request.
 */
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
    // Deliberately NO category: a per-type opt-out must not be able to silence
    // a notice that the account's own defences changed.
  } catch (err) {
    // Never fails the request — but never silent either.
    console.error("[wallet-security] could not notify the owner:", err.message);
  }
}

// PUT /api/wallet/security  { enabled, answers: [{id, prompt, answer}] }
async function set(req, res) {
  try {
    const { enabled, answers } = req.body || {};

    // What it is NOW, so the log can say whether a lock was actually removed
    // rather than a switch flipped that was already off.
    const before = await User.findById(req.user._id).select("walletSecurity.enabled").lean();
    const wasEnabled = Boolean(before && before.walletSecurity && before.walletSecurity.enabled);

    if (!enabled) {
      await User.updateOne(
        { _id: req.user._id },
        { $set: { "walletSecurity.enabled": false, "walletSecurity.questions": [] } }
      );
      if (wasEnabled) await announceChange(req.user._id, "disabled");
      return res.json({ enabled: false, questions: [] });
    }

    if (!Array.isArray(answers) || answers.length < 3) {
      return res.status(400).json({ error: "Choose at least three questions and answer each." });
    }
    /**
     * BOUNDED. Each answer costs a bcrypt hash, deliberately slow, and the
     * list length came straight from the request: ten thousand entries was
     * ten thousand hashes on one call, a CPU denial of service from any
     * signed in account. Nobody needs more than a handful of questions.
     */
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
    if (wasEnabled) await announceChange(req.user._id, "replaced");
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

    const supplied = Array.isArray(req.body && req.body.answers)
      ? req.body.answers.slice(0, MAX_QUESTIONS)
      : [];

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
      /**
       * 403, NOT 401. The browser's HTTP client treats every 401 as "this
       * session is over": it clears the token and shows the sign in screen.
       * A wrong security answer answered 401 here, so one mistyped childhood
       * street signed the owner out of the whole application. The session is
       * fine; the answer was wrong. That is a 403.
       */
      return res.status(locked ? 429 : 403).json({
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
