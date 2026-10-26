const mongoose = require("mongoose");

const nativeDeviceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  token: { type: String, required: true },
  platform: { type: String, enum: ["android", "ios"], required: true },
  userAgent: { type: String },
  createdAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
});

nativeDeviceSchema.index({ token: 1 }, { unique: true });

module.exports = mongoose.model("NativeDevice", nativeDeviceSchema);
