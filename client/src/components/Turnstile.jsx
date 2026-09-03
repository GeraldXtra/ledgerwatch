import { useEffect, useRef, useState } from "react";

/**
 * Cloudflare Turnstile widget.
 *
 * Rendered explicitly rather than by Cloudflare's auto scan of the page. The auto
 * mode hunts for elements on load, which does not survive a React remount: the
 * sign in and sign up forms are the same component swapping mode, so the widget
 * would render once and then quietly disappear the first time somebody toggled.
 *
 * The token is single use and short lived. Cloudflare expires it after roughly
 * five minutes, and the server rejects a reused one, so `onExpire` clears it and
 * makes the user tick again rather than letting them submit something the server
 * will refuse.
 *
 * With no site key configured the widget renders nothing and reports itself as
 * satisfied. That keeps a local developer with no Cloudflare account out of a
 * locked signup form, and matches how every other integration in this app
 * degrades. The server makes the same call independently: if it has no secret,
 * it skips the check. Neither side can be tricked by the other, because a client
 * that lies still fails the server's own verification.
 */
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
      // Let a later attempt retry rather than caching the failure for the life
      // of the page. A blocked script on one load is often fine on the next.
      scriptPromise = null;
      scriptEl = null;
      reject(new Error("Could not load the verification widget."));
    };
    scriptEl = el;
    document.head.appendChild(el);
  });
  return scriptPromise;
}

/**
 * THE THIRD PARTY SCRIPT DOES NOT FOLLOW THE USER INTO THE WALLET.
 *
 * Turnstile is the only script from another origin this application loads,
 * and it was loaded once and left resident for the life of the page. On a
 * single page app that meant the Cloudflare script was still present when the
 * person navigated from sign in to the wallet and typed their keystore
 * password. docs/SECURITY.md forbids exactly that.
 *
 * Called when the sign in page unmounts. It removes the script element, drops
 * the global the widget installed, and forgets the load, so the next visit to
 * sign in fetches it fresh. Code that already ran cannot be un-run, which is
 * why the Content Security Policy is the real control: it stops any script in
 * this page from sending anything to any host but the API. This is the second
 * layer, so the surface is as small as it can be made.
 */
export function unloadTurnstile() {
  try {
    if (scriptEl && scriptEl.parentNode) scriptEl.parentNode.removeChild(scriptEl);
  } catch {
    /* already gone */
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
          theme: "light",
          callback: (token) => alive && onToken(token),
          // A token that expires while the form is still open must not be
          // submitted; the server would reject it as a duplicate or stale.
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
          // Already gone with the DOM node. Nothing to clean up.
        }
      }
      widgetId.current = null;
    };
    // Mount once per form. `onToken` is recreated each render by the parent, and
    // depending on it would tear down and re-render the widget on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  /**
   * Unconfigured must be VISIBLE, not blank.
   *
   * This used to `return null`, so a missing site key produced an empty space
   * where the check should be and nothing anywhere said why. That is the exact
   * silent failure this project keeps writing rules against: the control was
   * off, the form still worked, and the only way to find out was to read the
   * source. Say it on the screen instead.
   *
   * Development only. A production build renders nothing rather than showing an
   * operational note to real users, and the boot warning on the server covers
   * that case for whoever is deploying.
   */
  if (!SITE_KEY) {
    if (!import.meta.env.DEV) return null;
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
