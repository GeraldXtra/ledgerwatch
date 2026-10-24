const { getLogosMap } = require("../services/coingecko.service");
const { resolveSymbol } = require("../services/coinMap");

const MAX_IDS = 250;

async function get(req, res) {
  try {
    const ids = [];

    for (const raw of String(req.query.ids || "").split(",")) {
      const id = raw.trim();
      if (id) ids.push(id);
    }

    for (const raw of String(req.query.symbols || "").split(",")) {
      const resolved = resolveSymbol(raw.trim());
      if (resolved) ids.push(resolved.coinId);
    }

    const wanted = [...new Set(ids)].slice(0, MAX_IDS);

    if (wanted.length === 0) {
      return res.json({ logos: {}, stale: false, updatedAt: null });
    }

    const { logos, stale, updatedAt } = await getLogosMap(wanted);
    return res.json({ logos, stale, updatedAt });
  } catch (err) {
    console.error("logos error:", err.message);
    return res.json({ logos: {}, stale: true, updatedAt: null });
  }
}

module.exports = { get };
