const { runAllPasses, getStatus } = require("../services/automation");

// POST /api/automation/run  (manual trigger — runs BOTH passes for the caller's data)
async function run(req, res) {
  try {
    const result = await runAllPasses({ userId: req.user._id });
    return res.json(result);
  } catch (err) {
    console.error("automation run error:", err.message);
    return res.status(500).json({ error: "Failed to run automation pass" });
  }
}

// GET /api/automation/status
function status(req, res) {
  return res.json(getStatus());
}

module.exports = { run, status };
