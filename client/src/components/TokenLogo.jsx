import { useEffect, useState } from "react";
import {
  getLogoUrl,
  markLogoBroken,
  requestLogo,
  subscribe,
} from "../features/wallet/tokenLogos";

/**
 * A token disc: the real coin logo when there is one, the lettered disc when
 * there is not.
 *
 * WHY THE LETTERS ARE ALWAYS RENDERED
 *
 * The lettered disc is not an error state, it is the floor. It is drawn on the
 * first frame and stays underneath the image for the whole of its life, so the
 * three states this component can be in — URL not known yet, URL loading, URL
 * failed — all look like exactly what the wallet looked like before logos
 * existed. There is never an empty hole waiting for a network round trip and
 * never a broken image glyph, and because the image is laid over the letters
 * rather than swapped with them, the row does not move when one arrives.
 *
 * A chain with no artwork therefore sits next to a chain that has some and
 * looks deliberate rather than broken.
 */

/**
 * First three alphanumerics of the symbol, uppercased.
 *
 * This must keep matching `mark()` in features/wallet/WalletPage.jsx. It is four
 * lines and that file's copy is not exported; if either is ever changed, change
 * both, or a wallet mid load will re-letter its discs as the logos resolve.
 */
function letters(symbol) {
  return String(symbol || "?")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 3)
    .toUpperCase();
}

/**
 * The logo URL for a symbol, re-rendering when the shared cache learns one.
 */
function useTokenLogo(symbol) {
  const [url, setUrl] = useState(() => getLogoUrl(symbol) || null);

  useEffect(() => {
    let alive = true;
    const sync = () => {
      if (alive) setUrl(getLogoUrl(symbol) || null);
    };
    sync(); // a symbol already in cache must not wait for a notify that never comes
    requestLogo(symbol);
    const off = subscribe(sync);
    return () => {
      alive = false;
      off();
    };
  }, [symbol]);

  return url;
}

/**
 * @param {object} props
 * @param {string} props.symbol   Token symbol as the wallet holds it, e.g. "WETH".
 * @param {number} [props.size]   Disc diameter in px. Default 36, the wallet row size.
 * @param {boolean} [props.native]  Gold variant: the token that pays for gas.
 * @param {boolean} [props.unknown] Warn variant: the balance could not be read.
 * @param {string} [props.className] Extra classes, appended.
 * @param {string} [props.title]  Native tooltip, passed straight through.
 */
export default function TokenLogo({
  symbol,
  size = 36,
  native = false,
  unknown = false,
  className = "",
  title,
}) {
  const url = useTokenLogo(symbol);
  const [loaded, setLoaded] = useState(false);

  // A new URL is a new load. Without this a symbol change would show the old
  // coin's artwork until the new file arrived.
  useEffect(() => {
    setLoaded(false);
  }, [url]);

  /**
   * An unreadable balance keeps the warn disc and gets no logo.
   *
   * The row next to it says the balance could not be read. Putting a crisp,
   * confident brand mark on that row would argue with the warning, and this
   * project's rule is that a failed read must look like a failed read.
   */
  const wantsImage = Boolean(url) && !unknown;

  const cls = [
    "mm-mark",
    "tk-logo",
    native ? "native" : "",
    unknown ? "unknown" : "",
    loaded && wantsImage ? "is-live" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={cls} style={{ "--tk-size": `${size}px` }} title={title}>
      <span className="tk-logo-letters">{letters(symbol)}</span>
      {wantsImage ? (
        <img
          className="tk-logo-img"
          src={url}
          // The symbol is already spelled out in the row beside this, so naming
          // it again here would have a screen reader read every token twice.
          alt=""
          loading="lazy"
          decoding="async"
          // Revealed by `is-live` only once it has actually decoded, so a file
          // that 404s is never visible for a frame on its way to being removed.
          onLoad={() => setLoaded(true)}
          onError={() => markLogoBroken(symbol)}
        />
      ) : null}
    </span>
  );
}
