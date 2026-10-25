const { z, objectId, text, numberish, integerish, emptyOr, dateish, booleanish } = require("./fields");

const idParams = z.object({ id: objectId });

const debtFields = {
  debtorName: text(120),
  debtorPhone: text(40).nullable(),
  debtorEmail: text(254).nullable(),
  amount: emptyOr(numberish),
  dueDate: emptyOr(dateish),
  note: text(2000).nullable(),
  reminderCadenceDays: emptyOr(integerish).nullable(),
};

const debtBody = z.object(Object.fromEntries(Object.entries(debtFields).map(([k, v]) => [k, v.optional()])));

module.exports = {
  create: { body: debtBody },
  list: {
    query: z.object({
      status: emptyOr(z.enum(["pending", "partially_paid", "paid"])).optional(),
      sort: emptyOr(z.enum(["amount", "balance", "due", "overdue", "debtor", "status", "created"])).optional(),
      search: text(200).optional(),
      from: emptyOr(dateish).optional(),
      to: emptyOr(dateish).optional(),
    }),
  },
  byId: { params: idParams },
  update: { params: idParams, body: debtBody },
  remove: { params: idParams, query: z.object({ force: z.enum(["true", "false"]).optional() }) },
  send: {
    params: idParams,
    body: z.object({ channels: z.array(z.enum(["whatsapp", "email"])).max(2).optional() }),
  },
  recordPayment: {
    params: idParams,
    body: z.object({
      amount: numberish.optional(),
      method: z.enum(["cash", "transfer", "other"]).optional(),
      note: text(500).nullable().optional(),
      paidAt: emptyOr(dateish).nullable().optional(),
      idempotencyKey: text(80).optional(),
    }),
  },
  removePayment: { params: z.object({ id: objectId, paymentId: objectId }) },
  share: { params: idParams, body: z.object({ renew: z.boolean().optional() }) },
  receipt: { params: idParams, query: z.object({ paymentId: objectId.optional() }) },
  booleanish,
};
