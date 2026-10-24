const mongoose = require("mongoose");

const TOPICS = ["payment", "wallet", "market", "account", "security", "other"];

const contactMessageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 160 },
  topic: { type: String, enum: TOPICS, default: "other" },
  message: { type: String, required: true, maxlength: 4000 },
  page: { type: String, default: "", maxlength: 200 },
  userAgent: { type: String, default: "", maxlength: 300 },
  emailed: { type: Boolean, default: false },
  emailError: { type: String, default: "" },
  status: { type: String, enum: ["new", "read", "closed"], default: "new", index: true },
  createdAt: { type: Date, default: Date.now, index: true },
});

module.exports = mongoose.model("ContactMessage", contactMessageSchema);
module.exports.TOPICS = TOPICS;
