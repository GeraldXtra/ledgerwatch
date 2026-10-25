function requestedMode(req) {
  const raw = (req.query && req.query.mode) || (req.body && req.body.mode);
  if (raw === "paper" || raw === "live") return raw;
  return req.user && req.user.tradingMode === "live" ? "live" : "paper";
}

module.exports = { requestedMode };
