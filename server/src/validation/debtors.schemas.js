const { z, text } = require("./fields");

const keyParams = z.object({ key: text(200).min(1) });

module.exports = {
  list: {},
  lookup: { query: z.object({ phone: text(40).optional(), name: text(120).optional() }) },
  byKey: { params: keyParams },
};
