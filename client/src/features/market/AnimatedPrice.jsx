import { useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { price as fmtPrice } from "./format";

/**
 * A price that visibly ticks: when `value` changes, it flashes green + up arrow if
 * it rose, red + down arrow if it fell, fading back over ~800ms. Respects
 * prefers-reduced-motion (no flash, just the new number).
 */
export default function AnimatedPrice({ value, format = fmtPrice, className = "" }) {
  const prev = useRef(value);
  const [dir, setDir] = useState(null); // "up" | "down" | null
  const timer = useRef(null);

  useEffect(() => {
    const before = prev.current;
    if (before != null && value != null && value !== before) {
      const reduce =
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduce) {
        setDir(value > before ? "up" : "down");
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setDir(null), 800);
      }
    }
    prev.current = value;
    return () => clearTimeout(timer.current);
  }, [value]);

  return (
    <span
      className={`animated-price num ${dir ? `tick-${dir}` : ""} ${className}`.trim()}
    >
      {dir === "up" && <ArrowUp size={12} className="tick-arrow" />}
      {dir === "down" && <ArrowDown size={12} className="tick-arrow" />}
      {format(value)}
    </span>
  );
}
