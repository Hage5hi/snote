import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const raw = source("supabase/functions/raw/index.ts");

describe("raw legacy dump containment", () => {
  it("tombstones every lookup as an uncacheable generic response", () => {
    expect(raw).toMatch(
      /return jsonResponse\(\s*\{ found: false \},\s*410,?\s*\)/,
    );
    expect(raw).toContain('"cache-control": "no-store"');
    expect(raw).toContain('"cdn-cache-control": "no-store"');
    expect(raw).not.toContain("createClient");
    expect(raw).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("contains no content, locator, or database lookup path", () => {
    expect(raw).not.toContain("searchParams");
    expect(raw).not.toContain('.from("notes")');
    expect(raw).not.toContain("ydoc_state");
    expect(raw).not.toContain("data.content");
    expect(raw).not.toContain("Invalid slug");
    expect(raw).not.toContain("decrypt");
    expect(raw).not.toContain("slug");
    expect(raw).not.toContain("s-maxage");
    expect(raw).not.toContain("stale-while-revalidate");
  });

  it("documents the committed raw tombstone instead of a live dump", () => {
    const findings = source("docs/security-findings.md");
    const capability = source("docs/capability-backend.md");
    const agents = source("AGENTS.md");

    expect(findings).toContain("committed `raw` Edge function is a generic `410 no-store` tombstone");
    expect(findings).toContain("Do not probe production `raw` with a real locator");
    expect(capability).toContain("legacy credential-free `raw` Edge dump is a permanent `410` tombstone");
    expect(agents).toContain("committed `raw` Edge function is a `410 no-store` tombstone");
    expect(agents).toMatch(/Do not probe\s+production `raw` with a real slug/);
  });
});
