import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("share-view revocation cache contract", () => {
  it("marks every JSON response as no-store", () => {
    const endpoint = readFileSync(
      resolve(process.cwd(), "supabase/functions/share-view/index.ts"),
      "utf8",
    );
    const shared = readFileSync(
      resolve(process.cwd(), "supabase/functions/_shared/capability-edge.ts"),
      "utf8",
    );

    expect(shared).toMatch(/function capabilityJson[\s\S]*?"Cache-Control":\s*"no-store"/);
    expect(shared).toContain('"CDN-Cache-Control": "no-store"');
    expect(shared).toContain('"Vary": "Authorization, X-Legacy-Share"');
    expect(endpoint).not.toMatch(/console\.(?:log|info|warn|error)/);
    expect(endpoint).not.toContain("String(e)");
    expect(endpoint).toContain('capabilityFailure("unavailable")');
  });
});
