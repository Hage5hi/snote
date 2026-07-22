import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const functions = ["share-create", "share-revoke"] as const;

function readFunction(name: (typeof functions)[number]): string {
  return readFileSync(
    resolve(process.cwd(), `supabase/functions/${name}/index.ts`),
    "utf8",
  );
}

describe.each(functions)("%s mutation response containment", (name) => {
  it("marks every JSON response as uncacheable at the browser and CDN", () => {
    const source = readFunction(name);

    expect(source).toMatch(
      /function json[\s\S]*?headers:\s*\{[\s\S]*?"Cache-Control":\s*"no-store"[\s\S]*?"CDN-Cache-Control":\s*"no-store"[\s\S]*?\}/,
    );
  });

  it("returns a generic 503 for configuration, database, and caught failures", () => {
    const source = readFunction(name);

    expect(source).toContain('json({ error: "temporarily unavailable" }, 503)');
    expect(source).not.toContain("console.error");
    expect(source).not.toContain("String(e)");
    expect(source).not.toMatch(/json\(\{ error: [^"}]/);
  });
});
describe("share-create success response", () => {
  it("still returns the generated token through the no-store JSON helper", () => {
    const source = readFunction("share-create");

    expect(source).toContain("return json({ token }, 200)");
  });
});
