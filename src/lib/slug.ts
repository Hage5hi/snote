// Single source of truth for note-slug validity and router-reserved names.
//
// `note`, `privacy`, and `s` are reserved by the router (src/App.tsx):
// `/note` dispatches to the admin panel inside SlugDispatcher, while
// `/privacy` and `/s` are static routes. A note whose slug equals a reserved
// name would be unreachable, so every creation and navigation path must
// reject reserved names — the contract test in
// src/lib/__tests__/slug-contract.test.ts keeps this list in sync with the
// actual route table.

export const SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const RESERVED_SLUGS = ["note", "privacy", "s"] as const;

export type ReservedSlug = (typeof RESERVED_SLUGS)[number];

/** True when `value` collides with a router-reserved single-segment path. */
export function isReservedSlug(value: string): value is ReservedSlug {
  return (RESERVED_SLUGS as readonly string[]).includes(value);
}

/** A slug is usable when it matches the charset/length rule and is not reserved. */
export function isUsableSlug(value: string): boolean {
  return SLUG_RE.test(value) && !isReservedSlug(value);
}
