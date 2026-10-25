const { z, text } = require("./fields");

const network = text(20).optional();
const address = text(200).optional();

const utxoQuery = z.object({ coin: text(20).optional(), address, network, txid: text(100).optional() });

module.exports = {
  utxoCoins: {},
  utxoRead: { query: utxoQuery },
  utxoBroadcast: { body: z.object({ coin: text(20).optional(), rawTx: text(200000).optional(), network }) },
  tronRead: {
    query: z.object({
      address,
      network,
      txid: text(100).optional(),
      owner: address,
      to: address,
      amount: text(80).optional(),
    }),
  },
  tronBroadcast: { body: z.object({ hex: text(20000).optional(), network }) },
  solanaRead: {
    query: z.object({ address, network, mint: address, signature: text(200).optional() }),
  },
  solanaSend: { body: z.object({ transaction: text(4096).optional(), network }) },
  tonRead: { query: z.object({ address, network }) },
  tonSend: { body: z.object({ boc: text(20000).optional(), network }) },
};
