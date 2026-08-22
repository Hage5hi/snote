// Single source of truth for note-slug validity and router-reserved names.
//
// `note`, `privacy`, and `s` are reserved by the router (src/App.tsx):
// `/privacy` and `/s` are static routes that react-router matches
// case-insensitively by default (so `/PRIVACY` and `/S` also dispatch away
// from notes), and `note` is claimed inside SlugDispatcher. Reserved-name
// rejection is therefore case-insensitive for all three names: a note whose
// slug is any case variant could be unreachable or dispatch to the wrong
// page. The contract test in src/lib/__tests__/slug-contract.test.tsx keeps
// this list in sync with the actual route table and proves the case
// behavior with the real router.

export const SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const RESERVED_SLUGS = ["note", "privacy", "s"] as const;

export type ReservedSlug = (typeof RESERVED_SLUGS)[number];

/** True when `value` collides (case-insensitively) with a router-reserved path. */
export function isReservedSlug(value: string): boolean {
  const lowered = value.toLowerCase();
  return (RESERVED_SLUGS as readonly string[]).some((slug) => slug === lowered);
}

/** A slug is usable when it matches the charset/length rule and is not reserved. */
export function isUsableSlug(value: string): boolean {
  return SLUG_RE.test(value) && !isReservedSlug(value);
}
