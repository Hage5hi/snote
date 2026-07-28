import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("application log privacy", () => {
  it("summarizes note locators instead of logging raw slugs", () => {
    const page = source("src/pages/NotePage.tsx");
    const cache = source("src/lib/yjs/doc-cache.ts");
    const provider = source("src/lib/yjs/provider.ts");

    expect(page).toContain('dlog("ack received", "locatorLength=", slug.length');
    expect(page).toMatch(
      /dlog\(\s*"posted locator",\s*"locatorLength=",\s*slug\.length/,
    );
    expect(page).not.toMatch(/dlog\("(?:ack received|posted slug)",\s*slug[,)]/);

    expect(cache).toContain("locatorLength: slug.length");
    expect(cache).toContain("locatorLength: oldest.length");
    expect(cache).not.toMatch(/log\([^\n]+, \{ slug(?:: oldest)? \}\)/);

    expect(provider).toContain("locatorLength: this.slug.length");
    expect(provider).not.toMatch(
      /saveSnapshot skipped: encryption mode mismatch[\s\S]{0,160}slug:\s*this\.slug/,
    );
    expect(provider).not.toMatch(
      /console\.warn\(\s*"[^"]+"\s*,\s*(?:e|error)\s*\)/,
    );
  });

  it("does not log unknown route paths that may contain legacy capabilities", () => {
    const notFound = source("src/pages/NotFound.tsx");
    expect(notFound).not.toContain("location.pathname");
    expect(notFound).not.toMatch(/console\.(?:log|warn|error)/);
    expect(notFound).not.toContain("useLocation");
  });

  it("never passes raw edge URLs, paths, queries, or client addresses to logs", () => {
    const worker = source("cloudflare-worker/worker.js");

    expect(worker).not.toMatch(
      /logEvent\([^)]*(?:request\.url|url\.pathname|url\.search|cf-connecting-ip)/,
    );
    expect(worker).not.toMatch(
      /console\.(?:log|warn|error)\([^)]*(?:request\.url|url\.pathname|url\.search|cf-connecting-ip)/,
    );
  });
});
