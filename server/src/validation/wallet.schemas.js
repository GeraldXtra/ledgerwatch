const { z, objectId, text, numberish, emptyOr, chainId } = require("./fields");

const amount = z.union([text(100), z.number()]).nullable().optional();
const chainParams = z.object({ chainId });
const chainQuery = z.object({ chainId: emptyOr(chainId).optional() });

const rpcCall = z.object({
  jsonrpc: z.literal("2.0").optional(),
  id: z.union([z.number(), text(100), z.null()]).optional(),
  method: text(64),
  params: z.array(z.any()).max(16).optional(),
});

const answer = z.object({ id: text(64).optional(), prompt: text(300).optional(), answer: text(400).optional() });

module.exports = {
  chains: {},
  rpc: { params: chainParams, body: z.union([rpcCall, z.array(rpcCall).max(24)]) },
  setAddress: { body: z.object({ address: text(100).optional() }) },
  clearAddress: {},
  listTxs: { query: chainQuery },
  spend: {},
  recordTx: {
    body: z.object({
      chainId: chainId.optional(),
      hash: text(100).optional(),
      from: text(100).optional(),
      to: text(100).optional(),
      value: amount,
      symbol: text(40).nullable().optional(),
      tokenAddress: text(100).nullable().optional(),
      direction: z.enum(["in", "out"]).optional(),
      kind: z.enum(["transfer", "swap", "approval"]).optional(),
      tokenOut: text(100).nullable().optional(),
      tokenOutSymbol: text(40).nullable().optional(),
      amountOut: amount,
      minAmountOut: amount,
      feeTier: numberish.nullable().optional(),
      route: text(300).nullable().optional(),
      priceImpactPct: numberish.nullable().optional(),
      side: z.enum(["buy", "sell"]).nullable().optional(),
      alertId: objectId.nullable().optional(),
      profitId: objectId.nullable().optional(),
    }),
  },
  updateTxStatus: {
    params: z.object({ id: objectId }),
    body: z.object({ status: z.enum(["pending", "confirmed", "failed"]).optional() }),
  },
  discovered: { query: chainQuery },
  discoveredAct: {
    params: z.object({ chainId, address: text(100) }),
    body: z.object({ action: z.enum(["add", "ignore", "restore"]).optional() }),
  },
  listChainAddresses: {},
  setChainAddress: {
    body: z.object({ chain: text(20).optional(), network: text(20).optional(), address: text(200).optional() }),
  },
  securityGet: {},
  securitySet: { body: z.object({ enabled: z.boolean().optional(), answers: z.array(answer).max(6).optional() }) },
  securityVerify: { body: z.object({ answers: z.array(answer).max(6).optional() }) },
};
