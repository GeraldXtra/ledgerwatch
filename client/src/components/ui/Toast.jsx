import { createContext, useCallback, useContext, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Info, AlertCircle, X } from "lucide-react";

const ToastContext = createContext(null);

const ICON = {
  success: <Check size={15} />,
  info: <Info size={15} />,
  error: <AlertCircle size={15} />,
};

/**
 * Lightweight toast system. Wrap the app once with <ToastProvider>, then call
 * `const toast = useToast()` and `toast(message, { type })`. Toasts auto-dismiss
 * and render through a portal so they float above everything.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message, opts = {}) => {
      const id = ++idRef.current;
      const type = opts.type || "info";
      const duration = opts.duration ?? 4200;
      setToasts((list) => [...list, { id, message, type }]);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {createPortal(
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.type}`}>
              <span className="toast-icon">{ICON[t.type] || ICON.info}</span>
              <span className="toast-msg">{t.message}</span>
              <button
                type="button"
                className="toast-close"
                aria-label="Dismiss"
                onClick={() => dismiss(t.id)}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  // No-op fallback if a consumer is rendered outside the provider.
  return ctx || (() => {});
}
