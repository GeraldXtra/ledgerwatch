import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import Button from "./Button";

const MENU_WIDTH = 190;
const MENU_ITEM_HEIGHT = 36;
const GAP = 6;

/**
 * Row-action dropdown. `items`: [{ label, icon, danger?, onSelect }].
 * Positioned `fixed` (escapes table overflow clipping, flips up near the
 * viewport edge). Implements the ARIA menu-button keyboard pattern: focus
 * moves to the first item on open, ArrowUp/ArrowDown cycle, Esc/Tab close,
 * and focus returns to the trigger.
 */
export default function KebabMenu({ items, label = "Row actions" }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  function place() {
    const btn = triggerRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const menuHeight = items.length * MENU_ITEM_HEIGHT + 12;
    const openUp = r.bottom + GAP + menuHeight > window.innerHeight;
    setPos({
      top: openUp ? r.top - GAP - menuHeight : r.bottom + GAP,
      left: Math.max(8, r.right - MENU_WIDTH),
    });
  }

  function toggle() {
    if (!open) place();
    setOpen((o) => !o);
  }

  // Focus the first item when the menu opens.
  useLayoutEffect(() => {
    if (open && menuRef.current) {
      const first = menuRef.current.querySelector("button");
      if (first) first.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function close(restoreFocus) {
      setOpen(false);
      if (restoreFocus) {
        const btn = triggerRef.current && triggerRef.current.querySelector("button");
        if (btn) btn.focus();
      }
    }

    function onDown(e) {
      // The menu is portaled to <body>, so it's outside wrapRef — treat clicks
      // inside either the trigger wrap OR the menu as "inside".
      const inWrap = wrapRef.current && wrapRef.current.contains(e.target);
      const inMenu = menuRef.current && menuRef.current.contains(e.target);
      if (!inWrap && !inMenu) close(false);
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
        return;
      }
      if (e.key === "Tab") {
        close(false);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const buttons = menuRef.current
          ? Array.from(menuRef.current.querySelectorAll("button"))
          : [];
        if (!buttons.length) return;
        const idx = buttons.indexOf(document.activeElement);
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const next = buttons[(idx + delta + buttons.length) % buttons.length];
        next.focus();
      }
    }
    // reposition/close on scroll & resize so the fixed menu never drifts
    function onScroll() {
      close(false);
    }

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  return (
    <span className="kebab-wrap" ref={wrapRef}>
      <span ref={triggerRef} style={{ display: "inline-flex" }}>
        <Button
          variant="ghost"
          icon
          title={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggle}
        >
          <MoreHorizontal size={16} />
        </Button>
      </span>

      {open &&
        createPortal(
          <div
            className="kebab-menu"
            role="menu"
            aria-label={label}
            ref={menuRef}
            style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={item.danger ? "kebab-item danger" : "kebab-item"}
                onClick={() => {
                  setOpen(false);
                  const btn =
                    triggerRef.current && triggerRef.current.querySelector("button");
                  if (btn) btn.focus();
                  item.onSelect();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </span>
  );
}
