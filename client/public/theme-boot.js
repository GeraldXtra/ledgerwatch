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
    if (m) m.setAttribute("content", t === "dark" ? "#111416" : "#FFFCF3");
  } catch {
  }
})();
