import { useEffect, useState } from "react";

/**
 * Measures the active nav item so a SINGLE indicator can slide between items
 * instead of each item lighting its own marker. Give the container
 * `position: relative` and each item a `data-navitem="<id>"` attribute.
 *
 * Returns `{ top, height, left, width }`, or null when there is nothing to mark,
 * so the same hook serves both the vertical rail and the horizontal one.
 *
 * WHY IT WATCHES FONTS AND SCROLL
 *
 * The horizontal rail is measured in pixels off a label set in a webfont. On a
 * cold load the first measurement happens while the fallback face is still
 * showing, and Newsreader is materially narrower, so the brass underscore
 * settled a few pixels off the word and stayed there. `document.fonts.ready`
 * re-measures once the real face is in. The rail also scrolls horizontally on a
 * phone, and offsetLeft is relative to the container rather than the viewport,
 * so a scroll does not need a re-measure, but a resize does.
 */
export default function useSlidingIndicator(containerRef, activeId) {
  const [bar, setBar] = useState(null);

  useEffect(() => {
    let cancelled = false;

    function measure() {
      if (cancelled) return;
      const el = containerRef.current;
      if (!el) return;
      const active = el.querySelector(`[data-navitem="${activeId}"]`);
      if (!active) return setBar(null);
      setBar({
        top: active.offsetTop,
        height: active.offsetHeight,
        left: active.offsetLeft,
        width: active.offsetWidth,
      });
    }

    measure();

    // Re-measure once the real typeface has loaded. Guarded because `fonts` is
    // absent in jsdom and in older Safari.
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(measure).catch(() => {});
    }

    if (typeof ResizeObserver === "undefined") {
      return () => {
        cancelled = true;
      };
    }
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => {
      cancelled = true;
      ro.disconnect();
    };
  }, [containerRef, activeId]);

  return bar;
}
