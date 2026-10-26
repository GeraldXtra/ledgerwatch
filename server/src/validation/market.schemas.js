const { z, objectId, text, numberish, txHash, chainId, emptyOr } = require("./fields");

const mode = z.enum(["paper", "live"]);
const idParams = z.object({ id: objectId });
const modeQuery = z.object({ mode: mode.optional() });
const coinIds = text(17000);
const conditionType = z.enum(["drop_pct", "rise_pct", "price_below", "price_above"]);

module.exports = {
  alertsList: { query: modeQuery },
  alertById: { params: idParams },
  alertAct: {
    params: idParams,
    body: z.object({
      action: z.enum(["buy", "sell", "dismiss"]).optional(),
      amount: numberish.optional(),
      denom: z.enum(["token", "quote"]).optional(),
      mode: mode.optional(),
    }),
  },
  alertExecuted: {
    params: idParams,
    body: z.object({
      side: z.enum(["buy", "sell"]).optional(),
      txHash: txHash.optional(),
      chainId: chainId.nullable().optional(),
      qty: numberish.nullable().optional(),
      value: numberish.nullable().optional(),
      price: numberish.nullable().optional(),
    }),
  },
  watchCreate: {
    body: z.object({
      symbol: text(40).optional(),
      coinId: text(64).optional(),
      type: conditionType.optional(),
      value: numberish.optional(),
      mode: mode.optional(),
    }),
  },
  watchList: { query: modeQuery },
  watchUpdate: {
    params: idParams,
    body: z.object({ type: conditionType.optional(), value: numberish.optional() }),
  },
  watchById: { params: idParams },
  portfolio: { query: modeQuery },
  profitsList: { query: z.object({ mode: emptyOr(mode).optional() }) },
  profitById: { params: idParams },
  coinsTop: { query: z.object({ limit: emptyOr(numberish).optional() }) },
  coinsSearch: { query: z.object({ q: text(200).optional() }) },
  coinsChart: {
    params: z.object({ id: text(64).regex(/^[a-zA-Z0-9-]{1,64}$/, "That is not a valid coin id.") }),
    query: z.object({ days: z.enum(["1", "7", "30", "90"]).optional() }),
  },
  prices: { query: z.object({ ids: coinIds.optional() }) },
  fiatRates: {},
  markets: { query: z.object({ ids: coinIds.optional(), mode: mode.optional() }) },
  logos: { query: z.object({ ids: coinIds.optional(), symbols: coinIds.optional() }) },
};
