// Detect whether the web app is running inside the Syrin Note Chrome
// extension side panel. The extension loads the app with `?from=ext`; we
// persist the flag to sessionStorage so subsequent client-side navigations
// (which drop the query param) still know they're inside the extension.

const STORAGE_KEY = "syrin:from-ext";

function detect(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("from") === "ext") {
      try {
        sessionStorage.setItem(STORAGE_KEY, "1");
      } catch {
        // ignore quota / privacy errors
      }
      return true;
    }
    try {
      return sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

export const isExtensionContext = detect();
