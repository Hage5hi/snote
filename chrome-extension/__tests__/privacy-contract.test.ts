import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("extension privacy contract", () => {
  it("documents the permissions and storage actually used at runtime", () => {
    const manifest = JSON.parse(read("chrome-extension/manifest.json"));
    const privacy = read("src/pages/Privacy.tsx");
    const sidepanel = read("chrome-extension/sidepanel.js");

    expect(manifest.permissions).toEqual(["sidePanel", "storage"]);
    expect(privacy).toContain("chrome.storage.sync");
    expect(privacy).toContain("chrome.storage.local");
    expect(privacy).toContain("Owner capabilities are never");
    expect(privacy).toContain("edit capabilities");
    expect(privacy).toMatch(
      /Events older than 7 days are\s+discarded the next time diagnostics are read or written/,
    );
    expect(privacy).not.toContain("retained for up to 7 days");
    expect(privacy).not.toContain("declares one Chrome permission");
    expect(privacy).not.toMatch(/do not request[\s\S]{0,160}<code>storage<\/code>/);
    expect(sidepanel).not.toContain("chrome.storage.local.get(defaults");
    expect(sidepanel).toContain("storage.sync unavailable, using defaults");
  });

  it("discloses network metadata without claiming IP geolocation", () => {
    const privacy = read("src/pages/Privacy.tsx");

    expect(privacy).toContain("standard connection metadata");
    expect(privacy).toContain("browser language");
    expect(privacy).toContain("does not use IP geolocation");
  });

  it("keeps the store listing and options copy aligned with the manifest", () => {
    const listing = read("chrome-extension/STORE_LISTING.md");
    const options = read("chrome-extension/options.html");
    const readme = read("chrome-extension/README.md");
    const privacy = read("src/pages/Privacy.tsx");

    expect(listing).toContain("## What's new — v1.3.5");
    expect(listing).not.toContain("**tabs**");
    expect(listing).toContain(
      "Events older than 7 days are discarded the next time diagnostics are read or written",
    );
    expect(options).toContain(
      "Events older than 7 days are discarded the next time diagnostics are read or written",
    );
    expect(listing).not.toContain("retained for up to 7 days");
    expect(options).not.toContain("retained for up to 7 days");
    expect(options).toContain("never uploaded automatically");
    for (const copy of [listing, readme, privacy]) {
      expect(copy).not.toMatch(/chrome\.storage\.local[^\n.]*settings fallback/i);
      expect(copy).not.toMatch(/chrome\.storage\.local[^\n.]*device-local fallback/i);
    }
    expect(listing).toContain("sync is unavailable, the panel uses safe defaults");
    expect(privacy).toContain("sync is unavailable, the panel uses safe defaults");
  });

  it("requires both the exact app origin and the embedded iframe source", () => {
    const sidepanel = read("chrome-extension/sidepanel.js");
    const sourceGuardAt = sidepanel.indexOf("event.source !== iframe?.contentWindow");
    const originGuardAt = sidepanel.indexOf("event.origin !== APP_ORIGIN");
    const slugHandlerAt = sidepanel.indexOf('data.type === "syrin:slug"');

    expect(sourceGuardAt).toBeGreaterThan(-1);
    expect(originGuardAt).toBeGreaterThan(sourceGuardAt);
    expect(slugHandlerAt).toBeGreaterThan(originGuardAt);
  });
});
