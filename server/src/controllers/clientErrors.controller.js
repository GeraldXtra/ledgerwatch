const { reportProblem, scrub } = require("../services/opsAlert.service");

function report(req, res) {
  const { message, stack, page, kind } = req.body;
  const text = scrub(message || "Unknown browser error").slice(0, 500);
  const where = scrub(page || "an unknown page").slice(0, 300);
  console.warn(`[browser] ${kind || "error"} on ${where}: ${text}`);
  reportProblem({
    area: "browser",
    message: `${text} (on ${where})`,
    detail: [stack, req.headers["user-agent"]].filter(Boolean).join("\n\n"),
  });
  return res.status(204).end();
}

module.exports = { report };
