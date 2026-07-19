import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("SharePage crawler metadata", () => {
  it("uses generic metadata that never includes the share token", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./SharePage.tsx", import.meta.url)),
      "utf8",
    );

    expect(source).toContain(
      'const SHARE_CANONICAL_URL = "https://note.syrin.online/s";',
    );
    expect(source).toContain(
      'const SHARE_ROBOTS = "noindex,nofollow,noarchive,nosnippet";',
    );
    expect(source).not.toContain("snote.lovable.app");
    expect(source).not.toMatch(/(?:canonical|og:url)[^\n]*\$\{token\}/);
  });
});
