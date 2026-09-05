const mongoose = require("mongoose");

/**
 * A message sent through the public Contact page.
 *
 * Stored FIRST, emailed second. Email on this server degrades to a no-op when
 * SMTP is not configured, and a support message that was silently dropped
 * because a mail variable was blank is the kind of failure this project has
 * been bitten by before. The row is the record; the email is a convenience.
 *
 * Follows the house rules for models: hand-declared createdAt, no timestamps
 * option, no hooks, no virtuals. The sender's IP is deliberately not stored;
 * the rate limiter keys on it in memory and that is the only use it has.
 */
const TOPICS = ["payment", "wallet", "market", "account", "security", "other"];

const contactMessageSchema = new mongoose.Schema({
  // Set when the sender was signed in, so a report can be tied to the account
  // it is about. Never required: the page is public.
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 160 },
  topic: { type: String, enum: TOPICS, default: "other" },
  message: { type: String, required: true, maxlength: 4000 },
  // Which page the person was on when they wrote, if the client said.
  page: { type: String, default: "", maxlength: 200 },
  userAgent: { type: String, default: "", maxlength: 300 },
  // Whether the owner was emailed about it, and if not, why.
  emailed: { type: Boolean, default: false },
  emailError: { type: String, default: "" },
  status: { type: String, enum: ["new", "read", "closed"], default: "new", index: true },
  createdAt: { type: Date, default: Date.now, index: true },
});

module.exports = mongoose.model("ContactMessage", contactMessageSchema);
module.exports.TOPICS = TOPICS;
