const { getLogosMap } = require("../services/coingecko.service");
const { resolveSymbol } = require("../services/coinMap");

/**
 * How many coins one request may ask about.
 *
 * The ids go into a CoinGecko query string, so an unbounded list is an unbounded
 * URL built from user input. The wallet asks about the tokens on one chain, so
 * fifty is far above anything real and still bounded.
 */
const MAX_IDS = 50;

/**
 * GET /api/logos?ids=bitcoin,ethereum
 * GET /api/logos?symbols=BTC,ETH
 *
 * Logo URLs, served from the same cached markets rows the price endpoint reads.
 * Accepts coin ids directly, or symbols that the server already knows how to
 * resolve via coinMap — the same resolver /api/watches uses, so there is one
 * symbol table on this side rather than a second copy that can drift from it.
 *
 * Callers holding wallet symbols the server does not know (WETH, WBTC, USD₮0 and
 * the other wrapped tokens) resolve them client side and call with `ids`, which
 * is exactly what the wallet does for prices today.
 */
async function get(req, res) {
  try {
    const ids = [];

    for (const raw of String(req.query.ids || "").split(",")) {
      const id = raw.trim();
      if (id) ids.push(id);
    }

    for (const raw of String(req.query.symbols || "").split(",")) {
      const resolved = resolveSymbol(raw.trim());
      // An unknown symbol is simply skipped rather than 400ing the whole
      // request. One unrecognised token in a wallet must not cost the other
      // seven their logos.
      if (resolved) ids.push(resolved.coinId);
    }

    const wanted = [...new Set(ids)].slice(0, MAX_IDS);

    // Asking about nothing is not an error, it is an empty answer. Returning a
    // 400 here would make a caller with no mappable symbols handle a failure
    // that never happened.
    if (wanted.length === 0) {
      return res.json({ logos: {}, stale: false, updatedAt: null });
    }

    const { logos, stale, updatedAt } = await getLogosMap(wanted);
    return res.json({ logos, stale, updatedAt });
  } catch (err) {
    /**
     * Deliberately NOT the 500 its neighbours return.
     *
     * getLogosMap cannot throw — the CoinGecko layer serves stale cache and
     * swallows its own failures — so reaching here means something unforeseen
     * broke. Even then, a logo is decoration: the client falls back to the
     * lettered disc and every balance still renders correctly. A 500 would turn
     * a cosmetic gap into an error the wallet has to reason about, so this
     * answers with an empty map and says so in the log.
     *
     * A missing PRICE is the opposite case and is right to 500, because there
     * the UI would otherwise have to invent a number.
     */
    console.error("logos error:", err.message);
    return res.json({ logos: {}, stale: true, updatedAt: null });
  }
}

module.exports = { get };
