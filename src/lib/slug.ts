const SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const RESERVED_SLUGS = ["note", "privacy", "s"] as const;

export function isUsableSlug(value: string): boolean {
  return SLUG_RE.test(value) && !RESERVED_SLUGS.some((slug) => slug === value.toLowerCase());
}
