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
import Breadcrumbs from "./Breadcrumbs";

const openModals = [];

const WorkspaceContext = createContext(null);

const TrailContext = createContext(null);

export function TrailProvider({ trail, children }) {
  return <TrailContext.Provider value={trail}>{children}</TrailContext.Provider>;
}

export function WorkspaceProvider({ children }) {
  const [pane, setPane] = useState(null);
  const [entries, setEntries] = useState([]);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const add = useCallback((entry) => {
    setEntries((list) => [...list.filter((e) => e.id !== entry.id), entry]);
  }, []);
  const remove = useCallback((id) => {
    setEntries((list) => list.filter((e) => e.id !== id));
  }, []);
  const update = useCallback((id, patch) => {
    setEntries((list) => {
      let changed = false;
      const next = list.map((e) => {
        if (e.id !== id) return e;
        if (Object.keys(patch).every((k) => e[k] === patch[k])) return e;
        changed = true;
        return { ...e, ...patch };
      });
      return changed ? next : list;
    });
  }, []);
  const closeAbove = useCallback((id) => {
    const list = entriesRef.current;
    const at = list.findIndex((e) => e.id === id);
    if (at === -1) return;
    list
      .slice(at + 1)
      .reverse()
      .forEach((e) => e.back());
  }, []);

  const value = useMemo(
    () => ({ pane, setPane, entries, add, remove, update, closeAbove }),
    [pane, entries, add, remove, update, closeAbove]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}

function useDetailEntry({ back, view, params, crumb, active = true }) {
  const ws = useContext(WorkspaceContext);
  const trail = useContext(TrailContext);
  const idRef = useRef(null);
  if (idRef.current === null) idRef.current = {};
  const backRef = useRef(back);
  backRef.current = back;

  const name = view || "page";
  const paramsKey = params ? JSON.stringify(params) : "";
  const label = crumb || "";
  const infoRef = useRef(null);
  infoRef.current = { view: name, paramsKey, crumb: label };

  const add = ws ? ws.add : null;
  const remove = ws ? ws.remove : null;
  const update = ws ? ws.update : null;

  useLayoutEffect(() => {
    if (!add || !active) return undefined;
    const id = idRef.current;
    add({ id, back: () => backRef.current && backRef.current(), ...infoRef.current });
    return () => remove(id);
  }, [add, remove, active]);

  useLayoutEffect(() => {
    if (!update || !active) return;
    update(idRef.current, { view: name, paramsKey, crumb: label });
  }, [update, active, name, paramsKey, label]);

  const entries = ws ? ws.entries : [];
  const top = entries[entries.length - 1];
  const at = entries.findIndex((e) => e.id === idRef.current);
  const hidden = at !== -1 && top && top.id !== idRef.current;

  const crumbs =
    ws && trail
      ? [
          ...trail.map((t) => ({ label: t.label, to: t.to })),
          ...(at === -1 ? entries : entries.slice(0, at)).map((e) => ({
            label: e.crumb,
            onClick: () => ws.closeAbove(e.id),
          })),
          { label },
        ]
      : null;

  return { ws, hidden, crumbs };
}

export function DetailPane({ onBack, active = true, view, params, crumb, label, children }) {
  const { ws, hidden, crumbs } = useDetailEntry({ back: onBack, view, params, crumb, active });

  if (!ws || !ws.pane || !active) return null;
  return createPortal(
    <section className="pv" aria-label={label} hidden={hidden}>
      {crumbs && <Breadcrumbs items={crumbs} />}
      {children}
    </section>,
    ws.pane
  );
}

export default function Modal({
  onClose,
  label = "Dialog",
  size = "md",
  view,
  params,
  crumb,
  children,
}) {
  const panelRef = useRef(null);
  const previousFocusRef = useRef(null);
  if (previousFocusRef.current === null) {
    previousFocusRef.current = typeof document !== "undefined" ? document.activeElement : null;
  }

  const { ws, hidden, crumbs } = useDetailEntry({
    back: onClose,
    view,
    params,
    crumb: crumb || label,
  });

  useEffect(() => {
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    return () => {
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === "function" && document.contains(prev)) {
        prev.focus({ preventScroll: true });
      }
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
    <section
      className={`pv${size === "lg" ? " pv-lg" : ""}`}
      aria-label={label}
      tabIndex={-1}
      ref={panelRef}
      hidden={hidden}
    >
      {crumbs && <Breadcrumbs items={crumbs} />}
      {children}
    </section>
  );

  if (!ws) return createPortal(<div className="ws-solo">{panel}</div>, document.body);
  if (!ws.pane) return null;
  return createPortal(panel, ws.pane);
}
