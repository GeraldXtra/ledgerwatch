/**
 * Applies the saved or system theme BEFORE the first paint, so a dark page never
 * flashes light on load. Loaded as a file rather than inlined so the page's
 * Content Security Policy can say `script-src 'self'` with no exception for
 * inline code: an exception for one inline script is an exception for every
 * inline script an attacker manages to inject, and this page decrypts wallet
 * keys. src/theme.js applies the same rule when the toggle is used.
 */
(function () {
  try {
    var t = localStorage.getItem("ledgerwatch.theme");
    if (t !== "dark" && t !== "light") {
      t =
        window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    }
    document.documentElement.setAttribute("data-theme", t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", t === "dark" ? "#0f1216" : "#16283f");
  } catch (e) {
    /* storage unavailable: the stylesheet's light default applies */
  }
})();
