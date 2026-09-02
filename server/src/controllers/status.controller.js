const { cgStatus } = require("../services/coingecko.service");

/**
 * GET /api/status
 *
 * WHY THIS IS PUBLIC, AND WHY IT EXISTS AT ALL.
 *
 * Every price, every coin logo and every chart in this product comes from one
 * provider. When that provider stops answering, all three go blank at the same
 * moment and nothing on the screen or in the API says why — the market table
 * empties, the wallet draws lettered discs, and the chart shows "no data". From
 * the outside those look like three separate bugs in three separate features,
 * and the only way to tell otherwise was to read the server log, which most
 * hosts do not expose to the person who owns the deployment.
 *
 * That is the failure mode this whole codebase is written against: a silent
 * failure that presents as something other than what it is. So the server says
 * it out loud, on a URL that can be opened in a browser.
 *
 * IT IS SAFE TO EXPOSE. It reports booleans, counts, an upstream HTTP status and
 * the provider's own error text. No API key, no key prefix, no upstream URL, no
 * user data, and nothing about the database or the chains. `/api/push/key`
 * already answers `{configured:false}` publicly for the same reason: whether an
 * integration is switched on is not a secret, and hiding it only costs the owner
 * an afternoon.
 */
function get(_req, res) {
  const coingecko = cgStatus();

  return res.json({
    ok: true,
    // The one number that matters: can the market screens draw anything?
    marketDataAvailable: coingecko.cachedCoins > 0,
    coingecko,
  });
}

module.exports = { get };
