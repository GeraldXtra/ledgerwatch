import { useEffect, useRef, useState } from "react";

const EASE = (t) => 1 - Math.pow(1 - t, 3); // ease-out cubic

/**
 * Animates a number from 0 (or the previous value) to `to` over ~600ms.
 * Purely visual. `format(n)` controls rendering (defaults to locale string).
 * Respects prefers-reduced-motion by jumping straight to the target.
 */
export default function CountUp({ to = 0, duration = 600, format }) {
  const [display, setDisplay] = useState(to);
  const fromRef = useRef(0);
  const rafRef = useRef(null);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduce || !isFinite(to)) {
      setDisplay(to);
      fromRef.current = to;
      return;
    }

    const from = fromRef.current;
    const start = performance.now();

    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(from + (to - from) * EASE(t));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [to, duration]);

  const text = format
    ? format(display)
    : Math.round(display).toLocaleString("en-US");
  return <>{text}</>;
}
