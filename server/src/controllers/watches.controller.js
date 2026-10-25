const Watch = require("../models/Watch");
const { createWatch, updateWatchCondition } = require("../services/market.service");
const { requestedMode } = require("../utils/tradingMode");
const { assertCanTradeLive } = require("./trading.controller");

async function create(req, res) {
  try {
    const { symbol, type, value, coinId } = req.body || {};
    if ((!symbol && !coinId) || !type || value === undefined) {
      return res
        .status(400)
        .json({ error: "symbol (or coinId), type and value are required" });
    }
    const mode = requestedMode(req);
    if (mode === "live") assertCanTradeLive(req.user);
    const watch = await createWatch(req.user._id, { symbol, type, value, coinId }, mode);
    return res.status(201).json({ watch });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("create watch error:", err.message);
    return res.status(500).json({ error: "Failed to create watch" });
  }
}

async function update(req, res) {
  try {
    const { type, value } = req.body || {};
    const watch = await updateWatchCondition(req.user._id, req.params.id, {
      type,
      value,
    });
    return res.json({ watch });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("update watch error:", err.message);
    return res.status(500).json({ error: "Failed to update watch" });
  }
}

async function list(req, res) {
  try {
    const mode = requestedMode(req);
    const watches = await Watch.find({ userId: req.user._id, mode }).sort({ createdAt: -1 });
    return res.json({ watches, mode });
  } catch (err) {
    console.error("list watches error:", err.message);
    return res.status(500).json({ error: "Failed to list watches" });
  }
}

async function remove(req, res) {
  try {
    const watch = await Watch.findOne({ _id: req.params.id, userId: req.user._id });
    if (!watch) return res.status(404).json({ error: "Watch not found" });
    await watch.deleteOne();
    return res.json({ ok: true });
  } catch (err) {
    if (err && err.name === "CastError") {
      return res.status(404).json({ error: "Watch not found" });
    }
    console.error("delete watch error:", err.message);
    return res.status(500).json({ error: "That watch could not be removed just now." });
  }
}

module.exports = { create, list, update, remove };
