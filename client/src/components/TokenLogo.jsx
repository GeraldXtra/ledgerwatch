import { useEffect, useState } from "react";
import { Coins } from "lucide-react";
import {
  getLogoUrl,
  markLogoBroken,
  requestLogo,
  subscribe,
} from "../features/wallet/tokenLogos";

function useTokenLogo(symbol) {
  const [url, setUrl] = useState(() => getLogoUrl(symbol) || null);

  useEffect(() => {
    let alive = true;
    const sync = () => {
      if (alive) setUrl(getLogoUrl(symbol) || null);
    };
    sync();
    requestLogo(symbol);
    const off = subscribe(sync);
    return () => {
      alive = false;
      off();
    };
  }, [symbol]);

  return url;
}

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

  useEffect(() => {
    setLoaded(false);
  }, [url]);

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
      <span className="tk-logo-letters" aria-hidden="true">
        <Coins size={Math.max(12, Math.round(size * 0.5))} />
      </span>
      {wantsImage ? (
        <img
          className="tk-logo-img"
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => markLogoBroken(symbol)}
        />
      ) : null}
    </span>
  );
}
