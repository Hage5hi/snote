/** @vitest-environment node */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfigFromFile, type ConfigEnv } from "vite";
import { describe, expect, it, vi } from "vitest";

const root = process.cwd();
const buildEnvironment: ConfigEnv = {
  command: "build",
  mode: "production",
  isSsrBuild: false,
  isPreview: false,
};
const RELEASE_ENV_KEYS = ["SNOTE_RELEASE_SHA", "SNOTE_REQUIRE_RELEASE_SHA"] as const;

type VersionPayload = {
  buildId?: unknown;
  builtAt?: unknown;
  deployedSha?: unknown;
};

async function withReleaseEnv<T>(
  overrides: Partial<Record<(typeof RELEASE_ENV_KEYS)[number], string>>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = Object.fromEntries(
    RELEASE_ENV_KEYS.map((key) => [key, process.env[key]]),
  );

  for (const key of RELEASE_ENV_KEYS) {
    const next = overrides[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }

  try {
    return await fn();
  } finally {
    for (const key of RELEASE_ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function emitVersionPayload(): Promise<VersionPayload> {
  const loaded = await loadConfigFromFile(
    buildEnvironment,
    resolve(root, "vite.config.ts"),
  );
  if (!loaded) throw new Error("Expected Vite to load vite.config.ts");

  const versionPlugin = (loaded.config.plugins ?? []).find(
    (plugin) =>
      typeof plugin === "object" &&
      plugin !== null &&
      "name" in plugin &&
      plugin.name === "emit-version-json",
  );
  const generateBundle =
    typeof versionPlugin === "object" && versionPlugin !== null
      ? (versionPlugin as { generateBundle?: unknown }).generateBundle
      : undefined;
  if (typeof generateBundle !== "function") {
    throw new Error("Expected emit-version-json.generateBundle to be configured");
  }

  const emitted: Array<{ source?: string | Uint8Array }> = [];
  await (generateBundle as Function).call(
    {
      emitFile(asset: { source?: string | Uint8Array }) {
        emitted.push(asset);
        return "version.json";
      },
    },
    {},
    {},
  );

  const source = emitted.find((asset) => typeof asset.source === "string")?.source;
  if (typeof source !== "string") throw new Error("Expected version.json asset");
  return JSON.parse(source) as VersionPayload;
}

describe("release artifact identity contract", () => {
  it("stamps an exact approved commit SHA into a release version artifact", async () => {
    const deployedSha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const version = await withReleaseEnv(
      {
        SNOTE_RELEASE_SHA: deployedSha,
        SNOTE_REQUIRE_RELEASE_SHA: "1",
      },
      emitVersionPayload,
    );

    expect(version.buildId).toEqual(expect.any(String));
    expect(version.builtAt).toEqual(expect.any(String));
    expect(version.deployedSha).toBe(deployedSha);
  });

  it("fails closed for missing, malformed, or partially configured release identity", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        withReleaseEnv({ SNOTE_REQUIRE_RELEASE_SHA: "1" }, emitVersionPayload),
      ).rejects.toThrow(/SNOTE_RELEASE_SHA/);
      await expect(
        withReleaseEnv(
          { SNOTE_RELEASE_SHA: "ABCDEF", SNOTE_REQUIRE_RELEASE_SHA: "1" },
          emitVersionPayload,
        ),
      ).rejects.toThrow(/40-character lowercase commit SHA/);
      await expect(
        withReleaseEnv(
          { SNOTE_RELEASE_SHA: "0123456789abcdef0123456789abcdef01234567" },
          emitVersionPayload,
        ),
      ).rejects.toThrow(/SNOTE_REQUIRE_RELEASE_SHA=1/);
      const checkedOutSha = execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim();
      const differentSha =
        checkedOutSha[0] === "0"
          ? `1${checkedOutSha.slice(1)}`
          : `0${checkedOutSha.slice(1)}`;
      await expect(
        withReleaseEnv(
          { SNOTE_RELEASE_SHA: differentSha, SNOTE_REQUIRE_RELEASE_SHA: "1" },
          emitVersionPayload,
        ),
      ).rejects.toThrow(/does not match checked-out HEAD/);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("marks ordinary builds as unverified instead of fabricating a source SHA", async () => {
    const version = await withReleaseEnv({}, emitVersionPayload);

    expect(version.deployedSha).toBeNull();
  });

  it("exposes an explicit cross-platform release-build entry point", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    const releaseBuild = readFileSync("scripts/build-release.ts", "utf8");

    expect(packageJson.scripts?.["build:release"]).toBe(
      "bun run scripts/build-release.ts",
    );
    expect(releaseBuild).toContain(
      '["status", "--porcelain", "--untracked-files=all"]',
    );
    expect(releaseBuild).toContain("requires a clean Git worktree");
  });

  it("requires the live artifact to attest the approved SHA during post-deploy smoke", () => {
    const workflow = readFileSync(
      ".github/workflows/pwa-update-smoke-post-deploy.yml",
      "utf8",
    );
    const smoke = readFileSync(
      "e2e/pwa-update-production-readonly.spec.ts",
      "utf8",
    );
    const readme = readFileSync("e2e/README.md", "utf8");

    expect(workflow).toContain("EXPECTED_DEPLOYED_SHA: ${{ env.DEPLOYED_SHA }}");
    expect(smoke).toContain("version.deployedSha");
    expect(readme).toContain("source-stamped `deployedSha`");
    expect(readme).not.toContain("does not invent a source-SHA field");
  });

  it("exercises the same source-attested release build in CI without dispatching production", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const manifest = readFileSync(
      "docs/security/release-manifests/2026-07-capability-rollout.md",
      "utf8",
    );

    expect(ci).toContain("SNOTE_RELEASE_SHA: ${{ github.sha }}");
    expect(ci).toContain("bun run build:release");
    expect(ci).toContain("release version artifact must attest checked-out SHA");
    expect(ci).not.toContain("repository_dispatch:");
    expect(manifest).toContain("clean, immutable Git checkout");
  });
});
