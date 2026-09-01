import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const legacy = source("supabase/functions/legacy-note-open/index.ts");

describe("legacy-note-open dump containment", () => {
  it("tombstones the historical POST lookup as an uncacheable generic 410", () => {
    expect(legacy).toContain('req.method !== "POST"');
    expect(legacy).toMatch(
      /return jsonResponse\(\s*\{ found: false \},\s*410,?\s*\)/,
    );
    expect(legacy).toMatch(
      /return jsonResponse\(\s*\{ found: false \},\s*405,?\s*\)/,
    );
    expect(legacy).toContain('"cache-control": "no-store"');
    expect(legacy).toContain('"cdn-cache-control": "no-store"');
    expect(legacy).not.toContain("createClient");
    expect(legacy).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(legacy).not.toContain("gateway 404");
    expect(legacy).not.toContain("Production is not deployed");
  });

  it("contains no content, locator, or database lookup path", () => {
    expect(legacy).not.toContain("searchParams");
    expect(legacy).not.toContain('.from("notes")');
    expect(legacy).not.toContain("ydoc_state");
    expect(legacy).not.toContain("data.content");
    expect(legacy).not.toContain("SLUG_RE");
    expect(legacy).not.toContain("JSON.parse");
    expect(legacy).not.toContain("esm.sh");
    expect(legacy).not.toContain("@supabase/supabase-js");
    expect(legacy).not.toContain("slug");
    expect(legacy).not.toContain("s-maxage");
    expect(legacy).not.toContain("stale-while-revalidate");
  });

  it("documents the production-verified 410 tombstone", () => {
    const findings = source("docs/security-findings.md");

    expect(findings).toContain(
      "committed `legacy-note-open` Edge function is a generic `410 no-store` tombstone",
    );
    expect(findings).toContain(
      "The deployed `legacy-note-open` endpoint is production-verified",
    );
    expect(findings).toContain("Do not POST a locator to it");
    expect(findings).not.toContain("production remains 404 not-deployed");
    expect(findings).not.toContain("Do not claim a production 410 deploy");
  });
});
