// Edge-side mirror of src/lib/slug.ts. Keep both files in sync; the
// contract test in src/lib/__tests__/slug-contract.test.ts asserts the
// reserved list matches the router and that both Edge validators use this
// module.

export const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

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
