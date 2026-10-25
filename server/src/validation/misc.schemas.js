const { z, text } = require("./fields");

module.exports = {
  none: {},
  contact: {
    body: z.object({
      name: text(80).optional(),
      email: text(160).optional(),
      topic: text(40).optional(),
      message: text(4000).optional(),
      page: text(200).optional(),
      extra: text(5000).optional(),
      turnstileToken: text(4096).nullable().optional(),
    }),
  },
};
