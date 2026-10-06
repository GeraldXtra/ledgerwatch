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

function useDetailEntry(kind, screen, back, active = true) {
  const ws = useContext(WorkspaceContext);
  const idRef = useRef(null);
  if (idRef.current === null) idRef.current = {};
  const backRef = useRef(back);
  backRef.current = back;

  const add = ws ? ws.add : null;
  const remove = ws ? ws.remove : null;

  useLayoutEffect(() => {
    if (!add || !active) return undefined;
    const id = idRef.current;
    add({ id, kind, screen, back: () => backRef.current && backRef.current() });
    return () => remove(id);
  }, [add, remove, kind, screen, active]);

  const entries = ws ? ws.entries : [];
  const top = entries[entries.length - 1];
  const registered = entries.some((e) => e.id === idRef.current);
  const hidden = registered && top && top.id !== idRef.current;

  return { ws, hidden };
}

export function DetailPane({ screen = "screen", onBack, active = true, children }) {
  const { ws, hidden } = useDetailEntry("pane", screen, onBack, active);

  if (!ws || !ws.pane) return null;
  return createPortal(
    <section className="ws-sheet ws-sheet-base" hidden={hidden || !active}>
      {children}
    </section>,
    ws.pane
  );
}

export default function Modal({ onClose, label = "Dialog", size = "md", children }) {
  const panelRef = useRef(null);
  const previousFocusRef = useRef(null);
  if (previousFocusRef.current === null) {
    previousFocusRef.current = typeof document !== "undefined" ? document.activeElement : null;
  }

  const { ws, hidden } = useDetailEntry("dialog", "screen", onClose);

  useEffect(() => {
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    return () => {
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === "function") prev.focus();
    };
  }, []);

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
        if (top && mine && top !== mine) return;
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
