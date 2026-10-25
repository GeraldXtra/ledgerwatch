const Debt = require("../models/Debt");

const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

module.exports = {
  TOKEN_RE,
  debtByToken: (token) => (TOKEN_RE.test(String(token || "")) ? Debt.findOne({ publicToken: String(token) }) : Promise.resolve(null)),
};
