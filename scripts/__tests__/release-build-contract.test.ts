/** @vitest-environment node */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};
const viteConfig = readFileSync("vite.config.ts", "utf8");
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

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

  it("verifies source-attested release builds in CI", () => {
    expect(ciWorkflow.split(/\r?\n/)).toContain(
      "          SNOTE_RELEASE_SHA: ${{ github.sha }}",
    );
    expect(ciWorkflow).toContain("bun run build:release");
    expect(ciWorkflow).toContain(
      "release version artifact must attest checked-out SHA",
    );
  });

  it("attests the exact capability route flag in the version manifest", () => {
    expect(viteConfig).toContain('loadEnv(mode, process.cwd(), "VITE_")');
    expect(viteConfig).toContain(
      'env.VITE_CAPABILITY_ROUTES_ENABLED === "true"',
    );
    expect(viteConfig).toContain(
      "function emitVersionJson(capabilityRoutesEnabled: boolean)",
    );
    expect(viteConfig).toMatch(
      /JSON\.stringify\(\{[^}]*\bcapabilityRoutesEnabled\b/s,
    );
    expect(viteConfig).toContain("emitVersionJson(capabilityRoutesEnabled)");
  });

  it("checks disabled ordinary and enabled strict manifests in CI", () => {
    expect(
      ciWorkflow.match(
        /ordinary version artifact must attest disabled capability routes/g,
      ) ?? [],
    ).toHaveLength(1);
    expect(ciWorkflow.split(/\r?\n/)).toContain(
      '          VITE_CAPABILITY_ROUTES_ENABLED: "true"',
    );
    expect(
      ciWorkflow.match(
        /release version artifact must attest enabled capability routes/g,
      ) ?? [],
    ).toHaveLength(1);
  });
});
