import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const noteMeta = readFileSync(
  join(root, "supabase/functions/note-meta/index.ts"),
  "utf8",
);

describe("note-meta legacy share-token containment", () => {
  it("tombstones every token query before Supabase client initialization", () => {
    const tokenGuardAt = noteMeta.indexOf('url.searchParams.has("token")');
    const clientInitAt = noteMeta.indexOf("const supabase = createClient(");

    expect(tokenGuardAt).toBeGreaterThan(-1);
    expect(clientInitAt).toBeGreaterThan(tokenGuardAt);

    const preDatabasePath = noteMeta.slice(tokenGuardAt, clientInitAt);
    expect(preDatabasePath).toMatch(
      /return jsonResponse\(\s*\{ found: false \},\s*410,\s*\{\s*"cache-control": "no-store"\s*\},?\s*\)/,
    );
  });

  it("contains no legacy share lookup or token-derived slug/cache path", () => {
    expect(noteMeta).not.toContain('url.searchParams.get("token")');
    expect(noteMeta).not.toContain('.from("note_shares")');
    expect(noteMeta).not.toContain("TOKEN_RE");
    expect(noteMeta).not.toContain("resolvedSlug");
    expect(noteMeta).not.toMatch(/const\s+(?:raw)?token\s*=/i);
  });
});
