const { z, text } = require("./fields");

module.exports = {
  receivablesQuery: { body: z.object({ question: text(2000).optional() }) },
  chat: { body: z.object({ message: text(2000).optional(), mode: z.enum(["paper", "live"]).optional() }) },
};
