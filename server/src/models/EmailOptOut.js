const mongoose = require("mongoose");

const emailOptOutSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  email: { type: String, required: true },
  kind: { type: String, enum: ["reminders"], default: "reminders" },
  source: { type: String, enum: ["page", "one-click"], default: "page" },
  createdAt: { type: Date, default: Date.now },
});

emailOptOutSchema.index({ userId: 1, email: 1 }, { unique: true });

module.exports = mongoose.model("EmailOptOut", emailOptOutSchema);
