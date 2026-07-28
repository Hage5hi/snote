(function initializeTheme() {
  "use strict";

  try {
    var theme = localStorage.getItem("theme");
    var systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var dark =
      theme === "dark" || ((theme === "system" || !theme) && systemDark);
    var root = document.documentElement;

    if (dark) {
      root.classList.add("dark");
      root.style.background = "#0f0f12";
      document.body.style.background = "#0f0f12";
    } else {
      root.classList.remove("dark");
      root.style.background = "#ffffff";
      document.body.style.background = "#ffffff";
      root.style.colorScheme = "light";
    }
  } catch (_error) {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
})();
