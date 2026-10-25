const { z, text } = require("./fields");

const invoiceToken = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32}$/, "This payment link is not valid.") });
const unsubscribeToken = z.object({ token: text(700).min(10) });

module.exports = {
  invoice: { params: invoiceToken },
  unsubscribeInfo: { params: unsubscribeToken },
  unsubscribeAct: {
    params: unsubscribeToken,
    body: z.object({
      action: z.enum(["unsubscribe", "resubscribe"]).optional(),
      "List-Unsubscribe": z.literal("One-Click").optional(),
    }),
  },
};
