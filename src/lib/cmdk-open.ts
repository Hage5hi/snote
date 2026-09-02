export const CMDK_OPEN_EVENT = "snotes:cmdk";

/** Open the command palette, optionally seeding the query (e.g. `#work`). */
export function openCommandPalette(query?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CMDK_OPEN_EVENT, { detail: { query: query ?? "" } }));
}
