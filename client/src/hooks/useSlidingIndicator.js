import { useEffect, useState } from "react";

/**
 * Measures the active nav row so a single indicator bar can slide between rows
 * instead of each row lighting its own marker. Give the container
 * `position: relative` and each item a `data-navitem="<id>"` attribute.
 *
 * Returns `{ top, height }` for the bar, or null when there is nothing to mark.
 */
export default function useSlidingIndicator(containerRef, activeId) {
  const [bar, setBar] = useState(null);

  useEffect(() => {
    function measure() {
      const el = containerRef.current;
      if (!el) return;
      const active = el.querySelector(`[data-navitem="${activeId}"]`);
      if (!active) return setBar(null);
      setBar({ top: active.offsetTop, height: active.offsetHeight });
    }

    measure();

    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [containerRef, activeId]);

  return bar;
}
