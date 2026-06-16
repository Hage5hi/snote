// Shared slug validation used by both options.js and sidepanel.js.
// Plain ES module so vitest can import it directly.
export const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function isValidSlug(s) {
  return typeof s === "string" && SLUG_RE.test(s);
}
