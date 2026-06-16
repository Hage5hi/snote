// Pure function: build the iframe src URL for the side panel from user
// settings. Extracted so it can be unit-tested without a browser.
import { isValidSlug } from "./validate-slug.js";

export const DEFAULT_APP_ORIGIN = "https://note.syrin.online";

export function buildSrc({
  openMode = "home",
  defaultSlug = "",
  lastSlug = "",
  appOrigin = DEFAULT_APP_ORIGIN,
} = {}) {
  let path = "/";
  if (openMode === "slug" && isValidSlug(defaultSlug)) {
    path = `/${defaultSlug}`;
  } else if (openMode === "last" && isValidSlug(lastSlug)) {
    path = `/${lastSlug}`;
  }
  return `${appOrigin}${path}?from=ext`;
}

// Single-letter badge text the toolbar icon shows so the user knows what
// the side panel will open when they click it.
export function badgeForMode(openMode) {
  if (openMode === "slug") return "S";
  if (openMode === "last") return "L";
  return "H";
}
