import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS, isUsableSlug } from "../slug";
import {
  RESERVED_SLUGS as EDGE_RESERVED_SLUGS,
  isUsableSlug as edgeIsUsableSlug,
} from "../../../supabase/functions/_shared/slug";

describe("isUsableSlug", () => {
  it.each(["note", "NOTE", "Privacy", "s", "S", "", "has space", "a".repeat(65)])(
    "rejects %j",
    (slug) => {
      expect(isUsableSlug(slug)).toBe(false);
    },
  );

  it.each(["daily", "a_b", "x-y", "a".repeat(64)])("accepts %j", (slug) => {
    expect(isUsableSlug(slug)).toBe(true);
  });

  it("keeps reserved names in parity with Edge", () => {
    expect(RESERVED_SLUGS).toEqual(EDGE_RESERVED_SLUGS);
  });

  it.each(["note", "NOTE", "Privacy", "PRIVACY", "s", "S", "daily", "Daily"])(
    "matches Edge case-insensitive behavior for %j",
    (slug) => {
      expect(isUsableSlug(slug)).toBe(edgeIsUsableSlug(slug));
    },
  );
});
