import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

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

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
  const [pane, setPane] = useState(null);
  const [entries, setEntries] = useState([]);

  const add = useCallback((entry) => {
    setEntries((list) => [...list.filter((e) => e.id !== entry.id), entry]);
  }, []);
  const remove = useCallback((id) => {
    setEntries((list) => list.filter((e) => e.id !== id));
  }, []);

  const value = useMemo(
    () => ({ pane, setPane, entries, add, remove }),
    [pane, entries, add, remove]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}

function useDetailEntry(kind, screen, back) {
  const ws = useContext(WorkspaceContext);
  const idRef = useRef(null);
  if (idRef.current === null) idRef.current = {};
  const backRef = useRef(back);
  backRef.current = back;

  const add = ws ? ws.add : null;
  const remove = ws ? ws.remove : null;

  useLayoutEffect(() => {
    if (!add) return undefined;
    const id = idRef.current;
    add({ id, kind, screen, back: () => backRef.current && backRef.current() });
    return () => remove(id);
  }, [add, remove, kind, screen]);

  const entries = ws ? ws.entries : [];
  const top = entries[entries.length - 1];
  const registered = entries.some((e) => e.id === idRef.current);
  const hidden = registered && top && top.id !== idRef.current;

  return { ws, hidden };
}

export function DetailPane({ label, screen = "screen", onBack, children }) {
  const { ws, hidden } = useDetailEntry("pane", screen, onBack);

  if (!ws || !ws.pane) return null;
  return createPortal(
    <section className="ws-sheet ws-sheet-base" aria-label={label} hidden={hidden}>
      {children}
    </section>,
    ws.pane
  );
}

export default function Modal({ onClose, label = "Dialog", size = "md", children }) {
  const panelRef = useRef(null);
  // The opener is captured during the FIRST RENDER, before anything in the
  // dialog has taken focus. Captured in the effect it would have recorded an
  // autofocused input inside the dialog, and "restored" focus to a detached
  // node on close.
  const previousFocusRef = useRef(null);
  if (previousFocusRef.current === null) {
    previousFocusRef.current = typeof document !== "undefined" ? document.activeElement : null;
  }

  const { ws, hidden } = useDetailEntry("dialog", "screen", onClose);

  useEffect(() => {
    const panel = panelRef.current;
    // A form that autofocuses its first field has already taken focus by the
    // time this runs, and keeps it.
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
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
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const panel = (
    <div
      className={`ws-sheet ws-sheet-dialog stack${size === "lg" ? " ws-sheet-lg" : ""}`}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      ref={panelRef}
      hidden={hidden}
    >
      {children}
    </div>
  );

  if (!ws) return createPortal(<div className="ws-solo">{panel}</div>, document.body);
  if (!ws.pane) return null;
  return createPortal(panel, ws.pane);
}
