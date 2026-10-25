const { z, text } = require("./fields");

const subscription = z.object({
  endpoint: text(2048).optional(),
  expirationTime: z.union([z.number(), z.null()]).optional(),
  keys: z.object({ p256dh: text(256).optional(), auth: text(128).optional() }).optional(),
});

module.exports = {
  none: {},
  action: { body: z.object({ token: text(4096).optional(), action: text(40).nullable().optional() }) },
  resubscribe: { body: z.object({ oldEndpoint: text(2048).optional(), subscription: subscription.optional() }) },
  subscribe: { body: z.object({ subscription: subscription.optional(), replaces: text(2048).nullable().optional() }) },
  unsubscribe: { body: z.object({ endpoint: text(2048).optional() }) },
};
