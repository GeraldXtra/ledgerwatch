const { z, text, numberish, emptyOr } = require("./fields");

module.exports = {
  none: {},
  session: {
    body: z.object({
      mode: text(10).optional(),
      cryptoCurrencyCode: text(20).nullable().optional(),
      fiatAmount: emptyOr(numberish).nullable().optional(),
    }),
  },
  webhook: { body: z.object({ data: text(20000).optional() }) },
};
