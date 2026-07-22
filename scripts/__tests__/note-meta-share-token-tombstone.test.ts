import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const noteMeta = readFileSync(
  resolve(process.cwd(), "supabase/functions/note-meta/index.ts"),
  "utf8",
);

describe("note-meta legacy metadata containment", () => {
  it("tombstones every metadata lookup as an uncacheable generic response", () => {
    expect(noteMeta).toMatch(
      /return jsonResponse\(\s*\{ found: false \},\s*410,?\s*\)/,
    );
    expect(noteMeta).toContain('"cache-control": "no-store"');
    expect(noteMeta).toContain('"cdn-cache-control": "no-store"');
    expect(noteMeta).not.toContain("createClient");
    expect(noteMeta).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(noteMeta).not.toContain("NOTE_META_SECRET");
  });

  it("contains no content, locator, token, or database lookup path", () => {
    expect(noteMeta).not.toContain("searchParams");
    expect(noteMeta).not.toContain('.from("notes")');
    expect(noteMeta).not.toContain('.from("note_shares")');
    expect(noteMeta).not.toContain("snippet");
    expect(noteMeta).not.toContain("slug");
    expect(noteMeta).not.toContain("s-maxage");
    expect(noteMeta).not.toContain("stale-while-revalidate");
  });
});
