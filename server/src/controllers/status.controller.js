const { cgStatus } = require("../services/coingecko.service");

function get(_req, res) {
  const coingecko = cgStatus();

  return res.json({
    ok: true,
    marketDataAvailable: coingecko.cachedCoins > 0,
    coingecko,
  });
}

module.exports = { get };
