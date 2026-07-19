import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("extension privacy contract", () => {
  it("documents the permissions and storage actually used at runtime", () => {
    const manifest = JSON.parse(read("../manifest.json"));
    const privacy = read("../../src/pages/Privacy.tsx");

    expect(manifest.permissions).toEqual(["sidePanel", "storage"]);
    expect(privacy).toContain("chrome.storage.sync");
    expect(privacy).toContain("chrome.storage.local");
    expect(privacy).toContain(
      "Events older than 7 days are discarded the next time diagnostics are read or written",
    );
    expect(privacy).not.toContain("retained for up to 7 days");
    expect(privacy).not.toContain("declares one Chrome permission");
    expect(privacy).not.toMatch(/do not request[\s\S]{0,160}<code>storage<\/code>/);
  });

  it("discloses network metadata without claiming IP geolocation", () => {
    const privacy = read("../../src/pages/Privacy.tsx");

    expect(privacy).toContain("standard connection metadata");
    expect(privacy).toContain("browser language");
    expect(privacy).toContain("does not use IP geolocation");
  });

  it("keeps the store listing and options copy aligned with the manifest", () => {
    const listing = read("../STORE_LISTING.md");
    const options = read("../options.html");

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
  });
});
