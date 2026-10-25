const { z, objectId, text, integerish, emptyOr, chainId } = require("./fields");

const idParams = z.object({ id: objectId });

module.exports = {
  quote: {
    query: z.object({
      chainId: emptyOr(chainId).optional(),
      debtId: emptyOr(objectId).optional(),
      tokenSymbol: text(20).optional(),
    }),
  },
  allocate: { body: z.object({ chainId: chainId.optional() }) },
  create: {
    body: z.object({
      debtId: objectId.optional(),
      chainId: chainId.optional(),
      address: text(100).optional(),
      derivationIndex: integerish.optional(),
      tokenSymbol: text(20).nullable().optional(),
    }),
  },
  list: { query: z.object({ debtId: emptyOr(objectId).optional() }) },
  revoke: { params: idParams },
  recordSweep: {
    params: idParams,
    body: z.object({
      txHash: text(100).optional(),
      destination: text(100).optional(),
      amountUsdc: z.union([z.number(), text(80)]).optional(),
      gasFundedTxHash: text(100).nullable().optional(),
    }),
  },
};
