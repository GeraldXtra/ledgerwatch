const { z, text, integerish, emptyOr, chainId } = require("./fields");

module.exports = {
  setMode: { body: z.object({ mode: z.enum(["paper", "live"]).optional() }) },
  listTokens: { query: z.object({ chainId: emptyOr(chainId).optional() }) },
  addToken: {
    body: z.object({
      chainId: chainId.optional(),
      address: text(100).optional(),
      symbol: text(40).optional(),
      decimals: integerish.optional(),
    }),
  },
  removeToken: { body: z.object({ chainId: chainId.optional(), address: text(100).optional() }) },
  resolveToken: { query: z.object({ coinId: text(100).optional(), chainId: emptyOr(chainId).optional() }) },
};
