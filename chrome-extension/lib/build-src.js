// Pure function: build the iframe src URL for the side panel from user
// settings. Extracted so it can be unit-tested without a browser.
import { isValidSlug } from "./validate-slug.js";

export const DEFAULT_APP_ORIGIN = "https://note.syrin.online";
const EDIT_CAPABILITY_RE = /^[A-Za-z0-9_-]{43}$/;

export function buildSrc({
  openMode = "home",
  defaultSlug = "",
  lastSlug = "",
  editCapabilities = {},
  appOrigin = DEFAULT_APP_ORIGIN,
} = {}) {
  let path = "/";
  let selectedSlug = "";
  if (openMode === "slug" && isValidSlug(defaultSlug)) {
    path = `/${defaultSlug}`;
    selectedSlug = defaultSlug;
  } else if (openMode === "last" && isValidSlug(lastSlug)) {
    path = `/${lastSlug}`;
    selectedSlug = lastSlug;
  }
  const candidate = editCapabilities && typeof editCapabilities === "object"
    ? editCapabilities[selectedSlug]
    : "";
  const fragment = selectedSlug && EDIT_CAPABILITY_RE.test(candidate ?? "")
    ? `#edit=${candidate}`
    : "";
  return `${appOrigin}${path}?from=ext${fragment}`;
}

// Single-letter badge text the toolbar icon shows so the user knows what
// the side panel will open when they click it.
export function badgeForMode(openMode) {
  if (openMode === "slug") return "S";
  if (openMode === "last") return "L";
  return "H";
}
