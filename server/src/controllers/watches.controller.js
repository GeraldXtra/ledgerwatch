const Watch = require("../models/Watch");
const { createWatch, updateWatchCondition } = require("../services/market.service");

// POST /api/watches  body: { symbol, type, value, coinId? }
async function create(req, res) {
  try {
    const { symbol, type, value, coinId } = req.body || {};
    if ((!symbol && !coinId) || !type || value === undefined) {
      return res
        .status(400)
        .json({ error: "symbol (or coinId), type and value are required" });
    }
    const watch = await createWatch(req.user._id, { symbol, type, value, coinId }, req.user.tradingMode === "live" ? "live" : "paper");
    return res.status(201).json({ watch });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("create watch error:", err.message);
    return res.status(500).json({ error: "Failed to create watch" });
  }
}

// PATCH /api/watches/:id  body: { type?, value? } — edit the condition in place
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

// GET /api/watches
async function list(req, res) {
  try {
    const mode = req.user.tradingMode === "live" ? "live" : "paper";
    // Only this book's watches. A live user must not see paper watches.
    const watches = await Watch.find({ userId: req.user._id, mode }).sort({ createdAt: -1 });
    return res.json({ watches });
  } catch (err) {
    console.error("list watches error:", err.message);
    return res.status(500).json({ error: "Failed to list watches" });
  }
}

// DELETE /api/watches/:id
async function remove(req, res) {
  try {
    const watch = await Watch.findOne({ _id: req.params.id, userId: req.user._id });
    if (!watch) return res.status(404).json({ error: "Watch not found" });
    await watch.deleteOne();
    return res.json({ ok: true });
  } catch (err) {
    console.error("delete watch error:", err.message);
    return res.status(404).json({ error: "Watch not found" });
  }
}

module.exports = { create, list, update, remove };
