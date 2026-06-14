(() => {
  const iframe = document.getElementById("app");
  const loader = document.getElementById("loader");
  const fallback = document.getElementById("fallback");
  const openTab = document.getElementById("open-tab");

  let loaded = false;

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
      chrome.tabs.create({ url: "https://note.syrin.online" });
    } else {
      window.open("https://note.syrin.online", "_blank", "noopener");
    }
  });
})();
