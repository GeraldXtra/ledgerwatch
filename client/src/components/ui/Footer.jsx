/**
 * The colophon. A rule and one line at the foot of the page, the way a printed
 * record signs itself off.
 *
 * The line it replaced read "all trades are paper". That stopped being true the
 * day live DEX swaps shipped, and a false reassurance at the bottom of a screen
 * that can sign a real transaction is worse than no line at all.
 *
 * It then said "test networks only", which was true until mainnet was enabled
 * and false the moment it was. Twice now this one line has outlived the fact it
 * asserted, which is the argument for a colophon that states a PROPERTY of the
 * software rather than a state of the configuration: keys stay in the browser
 * and nothing signs without the owner, on any network, forever.
 */
export default function Footer() {
  return (
    <footer className="lw-colophon">
      <span>
        {/* This said "Test networks only, so nothing here moves real money"
            until mainnet was enabled, at which point it became a false
            reassurance printed on every screen in the application. What is left
            is what stays true on any network. */}
        Ledger<strong>Watch</strong>. Your keys stay in your browser and you approve every
        transaction.
      </span>
      <span>Prices from CoinGecko. Reminders over WhatsApp and email.</span>
    </footer>
  );
}
