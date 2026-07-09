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

declare const __BUILD_ID__: string;

/**
 * Post a `syrin:ready` handshake to the parent frame (the extension side
 * panel) so it can hide its loader based on real app-mounted state instead
 * of guessing from `iframe.onload`. Safe no-op outside the extension.
 *
 * We target `"*"` because the panel validates `event.origin` on receipt
 * (it only trusts messages from the app origin). This avoids a
 * bootstrapping problem where the app doesn't know the extension id.
 */
export function postExtensionReady(): void {
  if (!isExtensionContext) return;
  if (typeof window === "undefined") return;
  if (window.parent === window) return;
  const buildId = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
  try {
    window.parent.postMessage({ type: "syrin:ready", buildId }, "*");
  } catch {
    // ignore — parent may not be listening yet, panel retry covers this
  }
}
