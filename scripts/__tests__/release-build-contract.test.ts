/** @vitest-environment node */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};
const viteConfig = readFileSync("vite.config.ts", "utf8");

describe("release build contract", () => {
  it("exposes the strict release build wrapper", () => {
    expect(packageJson.scripts["build:release"]).toBe(
      "bun run scripts/build-release.ts",
    );
  });

  it("resolves and revalidates release identity for the version manifest", () => {
    expect(viteConfig).toMatch(/resolveReleaseIdentity\(\)/);
    expect(viteConfig).toMatch(/revalidateReleaseIdentity\(RELEASE_IDENTITY\)/);
    expect(viteConfig).toMatch(
      /JSON\.stringify\(\{[^}]*buildId:[^}]*builtAt:[^}]*\bdeployedSha\b/s,
    );
  });
});
