(() => {
  const APP_ORIGIN = "https://note.syrin.online";
  const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

  const iframe = document.getElementById("app");
  const loader = document.getElementById("loader");
  const fallback = document.getElementById("fallback");
  const openTab = document.getElementById("open-tab");

  let loaded = false;

  function buildSrc({ openMode, defaultSlug, lastSlug }) {
    let path = "/";
    if (openMode === "slug" && defaultSlug && SLUG_RE.test(defaultSlug)) {
      path = `/${defaultSlug}`;
    } else if (openMode === "last" && lastSlug && SLUG_RE.test(lastSlug)) {
      path = `/${lastSlug}`;
    }
    return `${APP_ORIGIN}${path}?from=ext`;
  }

  // Read user settings from chrome.storage.sync, then load the iframe.
  chrome.storage.sync.get(
    { openMode: "home", defaultSlug: "", lastSlug: "" },
    (settings) => {
      iframe.src = buildSrc(settings);
    },
  );

  iframe.addEventListener("load", () => {
    loaded = true;
    loader.classList.add("hidden");
    setTimeout(() => loader.remove(), 250);
  });

  // If the iframe is blocked by CSP / network, "load" never fires.
  // After 8 s show a fallback that opens the app in a new tab.
  setTimeout(() => {
    if (loaded) return;
    loader.hidden = true;
    iframe.hidden = true;
    fallback.hidden = false;
  }, 8000);

  openTab.addEventListener("click", () => {
    if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: APP_ORIGIN });
    } else {
      window.open(APP_ORIGIN, "_blank", "noopener");
    }
  });

  // Listen for slug updates from the web app so "resume last note" works.
  window.addEventListener("message", (event) => {
    if (event.origin !== APP_ORIGIN) return;
    const data = event.data;
    if (
      data &&
      typeof data === "object" &&
      data.type === "syrin:slug" &&
      typeof data.slug === "string" &&
      SLUG_RE.test(data.slug)
    ) {
      try {
        chrome.storage.sync.set({ lastSlug: data.slug });
      } catch (err) {
        console.error("[syrin-note] failed to save lastSlug", err);
      }
    }
  });
})();
