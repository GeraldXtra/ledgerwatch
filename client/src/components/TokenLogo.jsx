import { useEffect, useState } from "react";
import { Coins } from "lucide-react";
import {
  getLogoUrl,
  markLogoBroken,
  requestLogo,
  subscribe,
} from "../features/wallet/tokenLogos";

/**
 * A token disc: the real coin logo when there is one, a plain coin mark when
 * there is not yet.
 *
 * NO LETTERS, BY DESIGN. This used to draw the first three characters of the
 * symbol as a placeholder, so a row waiting on its artwork read "ETH", "WET",
 * "USD". The owner asked for that to go: it looked like a substitute for the
 * logo rather than a moment before it. What stands in now is a neutral coin
 * glyph on the same disc, which reads as "loading" and never as "this is the
 * token's mark".
 *
 * The glyph is the floor. It is drawn on the first frame and stays underneath
 * the image, so the three states this component can be in — URL not known
 * yet, URL loading, URL failed — all occupy the identical box. Because the
 * image is laid over it rather than swapped with it, the row does not move
 * when the artwork arrives. And because resolved URLs are persisted by the
 * logo cache, on every visit after the first the artwork is there from the
 * first frame and the glyph is never seen at all.
 */

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
      {/* Keeps the `tk-logo-letters` class so the existing stylesheet still
          fades it out the moment the real artwork decodes. */}
      <span className="tk-logo-letters" aria-hidden="true">
        <Coins size={Math.max(12, Math.round(size * 0.5))} />
      </span>
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
