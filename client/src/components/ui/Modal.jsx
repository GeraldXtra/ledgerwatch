import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * THE OPEN MODALS, OUTERMOST FIRST (LW-039).
 *
 * Every modal listened for Escape on `window`, and two listeners on the same
 * target cannot stop each other, so with a sweep running inside an invoice
 * dialog one Escape reached both: the sweep modal correctly ignored it, and the
 * invoice dialog behind it closed and unmounted the whole subtree while the
 * transactions kept broadcasting. Only the modal on top answers Escape now.
 */
const openModals = [];

/**
 * Modal dialog: overlay fade + panel rise. Closes on backdrop click and Esc.
 * Focus management: moves focus into the panel on open, traps Tab inside it,
 * and restores focus to the previously focused element on close.
 * `label` names the dialog for assistive tech.
 */
export default function Modal({ onClose, label = "Dialog", size = "md", children }) {
  const panelRef = useRef(null);
  const previousFocusRef = useRef(null);

  // Move focus in on open; restore it on unmount.
  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector(FOCUSABLE);
      (first || panel).focus();
    }
    return () => {
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === "function") prev.focus();
    };
  }, []);

  // Register on the stack for the life of this modal.
  useEffect(() => {
    const id = {};
    openModals.push(id);
    panelRef.current && (panelRef.current.__modalId = id);
    return () => {
      const at = openModals.indexOf(id);
      if (at !== -1) openModals.splice(at, 1);
    };
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") {
        const top = openModals[openModals.length - 1];
        const mine = panelRef.current && panelRef.current.__modalId;
        if (top && mine && top !== mine) return; // a modal above this one owns Escape
        onClose();
        return;
      }
      // Trap Tab within the panel.
      if (e.key === "Tab" && panelRef.current) {
        const focusables = Array.from(
          panelRef.current.querySelectorAll(FOCUSABLE)
        ).filter((el) => el.offsetParent !== null);
        if (!focusables.length) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal-panel stack ${size === "lg" ? "modal-lg" : ""}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
