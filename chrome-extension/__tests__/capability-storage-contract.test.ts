import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("chrome-extension/sidepanel.js"), "utf8");

describe("extension capability storage contract", () => {
  it("stores edit capabilities in chrome.storage.local", () => {
    expect(source).toContain("editCapability");
    expect(source).toMatch(/chrome\.storage\.local\.set\(\{\s*editCapabilities/);
  });

  it("never stores owner capabilities or the capability map in sync storage", () => {
    expect(source).not.toContain("ownerCapability");
    expect(source).not.toMatch(/chrome\.storage\.sync\.set\(\{\s*editCapabilities/);
  });
});
