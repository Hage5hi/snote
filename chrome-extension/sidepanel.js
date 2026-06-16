import { buildSrc, badgeForMode } from "./lib/build-src.js";
import { isValidSlug } from "./lib/validate-slug.js";

const APP_ORIGIN = "https://note.syrin.online";

const iframe = document.getElementById("app");
const loader = document.getElementById("loader");
const fallback = document.getElementById("fallback");
const openTab = document.getElementById("open-tab");

let loaded = false;
let lastSavedSlug = "";

// Attach the message listener BEFORE setting iframe.src so we don't race
// against the web app's first postMessage on slow loads.
window.addEventListener("message", (event) => {
  if (event.origin !== APP_ORIGIN) return;
  const data = event.data;
  if (
    !data ||
    typeof data !== "object" ||
    data.type !== "syrin:slug" ||
    !isValidSlug(data.slug)
  ) {
    return;
  }
  // Always ack so the web app can stop retrying — even if we skip the write.
  try {
    event.source?.postMessage({ type: "syrin:ack", slug: data.slug }, event.origin);
  } catch (err) {
    console.warn("[syrin-note] ack failed", err);
  }
  if (data.slug === lastSavedSlug) return; // throttle
  lastSavedSlug = data.slug;
  try {
    chrome.storage.sync.set({ lastSlug: data.slug }, () => {
      if (chrome.runtime.lastError) {
        console.error("[syrin-note] storage.set lastSlug failed", chrome.runtime.lastError);
      }
    });
  } catch (err) {
    console.error("[syrin-note] failed to save lastSlug", err);
  }
});

// Read user settings, then load the iframe.
chrome.storage.sync.get(
  { openMode: "home", defaultSlug: "", lastSlug: "" },
  (settings) => {
    lastSavedSlug = settings.lastSlug || "";
    iframe.src = buildSrc({ ...settings, appOrigin: APP_ORIGIN });
  },
);

iframe.addEventListener("load", () => {
  loaded = true;
  loader.classList.add("hidden");
  setTimeout(() => loader.remove(), 250);
});

// If the iframe is blocked by CSP / network, "load" never fires.
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

// Keep badge text accessible to the side panel too (no-op here, exported
// for future use if we want to badge inside the panel UI).
void badgeForMode;
