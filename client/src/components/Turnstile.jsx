import { useEffect, useRef, useState } from "react";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";

let scriptPromise = null;
let scriptEl = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = SCRIPT_SRC;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve(window.turnstile);
    el.onerror = () => {
      scriptPromise = null;
      scriptEl = null;
      reject(new Error("Could not load the verification widget."));
    };
    scriptEl = el;
    document.head.appendChild(el);
  });
  return scriptPromise;
}

export function unloadTurnstile() {
  try {
    if (scriptEl && scriptEl.parentNode) scriptEl.parentNode.removeChild(scriptEl);
  } catch {
  }
  scriptEl = null;
  scriptPromise = null;
  try {
    if (window.turnstile) delete window.turnstile;
  } catch {
    window.turnstile = undefined;
  }
}

export const turnstileEnabled = Boolean(SITE_KEY);

let warnedMissingKey = false;

export default function Turnstile({ onToken, action }) {
  const holder = useRef(null);
  const widgetId = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!SITE_KEY) {
      onToken("");
      return undefined;
    }
    let alive = true;

    loadTurnstile()
      .then((ts) => {
        if (!alive || !holder.current || !ts) return;
        widgetId.current = ts.render(holder.current, {
          sitekey: SITE_KEY,
          action,
          theme: document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light",
          callback: (token) => alive && onToken(token),
          "expired-callback": () => alive && onToken(""),
          "error-callback": () => {
            if (!alive) return;
            onToken("");
            setError("Verification could not load. Check your connection and try again.");
          },
        });
      })
      .catch((err) => alive && setError(err.message));

    return () => {
      alive = false;
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
        }
      }
      widgetId.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  if (!SITE_KEY) {
    if (!import.meta.env.DEV) {
      if (!warnedMissingKey) {
        warnedMissingKey = true;
        console.error(
          "[turnstile] VITE_TURNSTILE_SITE_KEY was not set at build time, so the verification " +
            "widget cannot render. If the server has TURNSTILE_SECRET_KEY set, every sign in and " +
            "sign up will be refused. Set it in the build environment and redeploy."
        );
      }
      return (
        <div className="turnstile-field" role="status">
          <div className="caption error-text">
            The human check could not load, so signing in is unavailable right now. This is a
            configuration problem on our side, not something you can fix — please try again
            shortly.
          </div>
        </div>
      );
    }
    return (
      <div className="turnstile-field turnstile-missing">
        <div>
          <strong>Verification is switched off.</strong>
          <div className="caption">
            Set VITE_TURNSTILE_SITE_KEY in client/.env and restart the dev server. Vite only reads
            .env at startup, so a running server will not pick it up.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="turnstile-field">
      <div ref={holder} />
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
