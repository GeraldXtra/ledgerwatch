import { useState } from "react";

export default function CoinImage({ src, symbol, size = 24, className = "coin-logo", quiet = false }) {
  const [failed, setFailed] = useState(null);
  if (!src || failed === src) return quiet ? null : <span className="coin-chip">{symbol}</span>;
  return (
    <img
      className={className}
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(src)}
    />
  );
}
