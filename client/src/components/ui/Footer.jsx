/**
 * Slim institutional footer under the page content.
 */
export default function Footer() {
  return (
    <footer className="footer">
      <span>
        Ledger<span style={{ fontWeight: 600 }}>Watch</span> — simulated demo
        environment. No real funds move; all trades are paper.
      </span>
      <span className="num">Prices via CoinGecko · Reminders via WhatsApp links</span>
    </footer>
  );
}
