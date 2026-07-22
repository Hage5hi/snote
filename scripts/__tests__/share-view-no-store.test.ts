import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("share-view revocation cache contract", () => {
  it("marks every JSON response as no-store", () => {
    const source = readFileSync(
      resolve(process.cwd(), "supabase/functions/share-view/index.ts"),
      "utf8",
    );

    expect(source).toMatch(
      /function json[\s\S]*?headers:\s*\{[\s\S]*?"Cache-Control":\s*"no-store"[\s\S]*?\}/,
    );
    expect(source).not.toMatch(
      /headers:\s*\{\s*\.\.\.corsHeaders,\s*"Content-Type":\s*"application\/json"\s*\}/,
    );
    expect(source).not.toContain("console.error");
    expect(source).not.toContain("String(e)");
    expect(source).toContain('json({ error: "temporarily unavailable" }, 503)');
  });
});
