const { runAllPasses, getStatus } = require("../services/automation");

async function run(req, res) {
  try {
    const result = await runAllPasses({ userId: req.user._id });
    return res.json(result);
  } catch (err) {
    console.error("automation run error:", err.message);
    return res.status(500).json({ error: "Failed to run automation pass" });
  }
}

function status(req, res) {
  return res.json(getStatus());
}

module.exports = { run, status };
