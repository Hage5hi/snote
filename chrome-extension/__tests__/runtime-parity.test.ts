import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("extension runtime parity", () => {
  it("shares the app origin and handshake protocol with the web app", () => {
    const extension = read("chrome-extension/lib/handshake-constants.js");
    const app = read("src/lib/ext-context.ts");
    const origin = read("src/lib/capability/url.ts");

    const extensionProtocol = extension.match(/HANDSHAKE_PROTOCOL\s*=\s*(\d+)/)?.[1];
    const appProtocol = app.match(/HANDSHAKE_PROTOCOL\s*=\s*(\d+)/)?.[1];
    const extensionOrigin = extension.match(/APP_ORIGIN\s*=\s*"([^"]+)"/)?.[1];
    const canonicalOrigin = origin.match(/CANONICAL_ORIGIN\s*=\s*"([^"]+)"/)?.[1];

    expect(extensionProtocol).toBeTruthy();
    expect(extensionProtocol).toBe(appProtocol);
    expect(extensionOrigin).toBe(canonicalOrigin);
  });

  it("does not issue privileged cross-origin diagnostics probes", () => {
    const sidepanel = read("chrome-extension/sidepanel.js");
    const manifest = JSON.parse(read("chrome-extension/manifest.json")) as {
      host_permissions?: string[];
    };

    expect(manifest.host_permissions ?? []).toEqual([]);
    expect(sidepanel).not.toMatch(/fetch\(\s*`\$\{APP_ORIGIN\}/);
    expect(sidepanel).not.toContain('headers.get("content-security-policy")');
    expect(sidepanel).toContain("navigator.onLine");
    expect(sidepanel).toContain("online-unverified");
    expect(sidepanel).toContain("not-inspected");
  });

  it("keeps versioned release and store copy aligned with the manifest", () => {
    const manifest = JSON.parse(read("chrome-extension/manifest.json")) as {
      version: string;
    };
    const readme = read("chrome-extension/README.md");
    const listing = read("chrome-extension/STORE_LISTING.md");

    expect(readme).toContain(`## What's new in v${manifest.version}`);
    expect(listing).toContain(`## What's new — v${manifest.version}`);
    expect(existsSync(`chrome-extension/RELEASE_NOTES_${manifest.version}.md`)).toBe(true);
    expect(listing).toContain("highlight.js");
    expect(listing).not.toContain("Shiki");
    expect(readme).not.toContain("App reachable (HEAD)");
    expect(readme).not.toContain("/version.json` HEAD probe");
  });
});
