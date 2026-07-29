/** @vitest-environment node */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfigFromFile, type ConfigEnv } from "vite";
import { describe, expect, it, vi } from "vitest";
import {
  resolveCleanGitHead,
  revalidateDeployedSha,
  type GitCommand,
} from "../release-identity";

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

type GitStep = {
  args: readonly string[];
  output?: string;
  error?: Error;
};

function createGitSequence(steps: readonly GitStep[]): {
  runGit: GitCommand;
  expectComplete: () => void;
} {
  let index = 0;
  return {
    runGit(args) {
      const step = steps[index++];
      if (!step) throw new Error(`Unexpected Git command: ${args.join(" ")}`);
      expect(args).toEqual(step.args);
      if (step.error) throw step.error;
      return step.output ?? "";
    },
    expectComplete() {
      expect(index).toBe(steps.length);
    },
  };
}

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
  type GenerateBundleHook = (
    this: {
      emitFile(asset: { source?: string | Uint8Array }): string;
    },
    outputOptions: object,
    bundle: object,
  ) => void | Promise<void>;
  await (generateBundle as GenerateBundleHook).call(
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
  describe("ordinary build Git identity", () => {
    const cleanSha = "0123456789abcdef0123456789abcdef01234567";

    it("returns the exact checked-out HEAD only for an empty successful status", () => {
      const calls: string[][] = [];

      const resolved = resolveCleanGitHead((args) => {
        calls.push([...args]);
        if (args[0] === "rev-parse") return `${cleanSha}\n`;
        if (args[0] === "status") return "";
        throw new Error(`Unexpected Git command: ${args.join(" ")}`);
      });

      expect(resolved).toBe(cleanSha);
      expect(calls).toEqual([
        ["rev-parse", "HEAD"],
        ["status", "--porcelain", "--untracked-files=all"],
      ]);
    });

    it.each([
      ["tracked changes", " M vite.config.ts\n"],
      ["untracked files", "?? local-secret.txt\n"],
    ])("returns null for %s", (_label, status) => {
      const resolved = resolveCleanGitHead((args) =>
        args[0] === "rev-parse" ? cleanSha : status,
      );

      expect(resolved).toBeNull();
    });

    it.each([
      ["an invalid HEAD", "not-a-sha"],
      ["an uppercase HEAD", cleanSha.toUpperCase()],
    ])("returns null for %s", (_label, head) => {
      const resolved = resolveCleanGitHead((args) =>
        args[0] === "rev-parse" ? head : "",
      );

      expect(resolved).toBeNull();
    });

    it.each(["rev-parse", "status"])(
      "returns null when Git %s is unavailable",
      (failingCommand) => {
        const resolved = resolveCleanGitHead((args) => {
          if (args[0] === failingCommand) {
            throw new Error("git unavailable");
          }
          return args[0] === "rev-parse" ? cleanSha : "";
        });

        expect(resolved).toBeNull();
      },
    );
  });

  describe("bundle-time Git identity revalidation", () => {
    const shaA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const shaB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const head = (sha: string): GitStep => ({
      args: ["rev-parse", "HEAD"],
      output: `${sha}\n`,
    });
    const status = (output = ""): GitStep => ({
      args: ["status", "--porcelain", "--untracked-files=all"],
      output,
    });

    it("drops an ordinary identity when HEAD changes before emission", () => {
      const sequence = createGitSequence([
        head(shaA),
        status(),
        head(shaB),
        status(),
      ]);
      const initialSha = resolveCleanGitHead(sequence.runGit);

      expect(initialSha).toBe(shaA);
      expect(revalidateDeployedSha(initialSha, "ordinary", sequence.runGit)).toBeNull();
      sequence.expectComplete();
    });

    it("drops an ordinary identity when the worktree becomes dirty", () => {
      const sequence = createGitSequence([
        head(shaA),
        status(),
        head(shaA),
        status(" M vite.config.ts\n"),
      ]);
      const initialSha = resolveCleanGitHead(sequence.runGit);

      expect(initialSha).toBe(shaA);
      expect(revalidateDeployedSha(initialSha, "ordinary", sequence.runGit)).toBeNull();
      sequence.expectComplete();
    });

    it("never upgrades an initially null ordinary identity", () => {
      const sequence = createGitSequence([
        head(shaA),
        status("?? untracked.txt\n"),
        head(shaB),
        status(),
      ]);
      const initialSha = resolveCleanGitHead(sequence.runGit);

      expect(initialSha).toBeNull();
      expect(revalidateDeployedSha(initialSha, "ordinary", sequence.runGit)).toBeNull();
      sequence.expectComplete();
    });

    it("keeps an ordinary identity when the clean HEAD is unchanged", () => {
      const sequence = createGitSequence([
        head(shaA),
        status(),
        head(shaA),
        status(),
      ]);
      const initialSha = resolveCleanGitHead(sequence.runGit);

      expect(revalidateDeployedSha(initialSha, "ordinary", sequence.runGit)).toBe(shaA);
      sequence.expectComplete();
    });

    it("throws in strict mode when HEAD changes before emission", () => {
      const sequence = createGitSequence([
        head(shaA),
        status(),
        head(shaB),
        status(),
      ]);
      const initialSha = resolveCleanGitHead(sequence.runGit);

      expect(() =>
        revalidateDeployedSha(initialSha, "strict", sequence.runGit),
      ).toThrow(/changed after configuration/);
      sequence.expectComplete();
    });

    it.each([
      {
        label: "Git is unavailable",
        emission: [
          {
            args: ["rev-parse", "HEAD"],
            error: new Error("git unavailable"),
          },
        ],
      },
      {
        label: "HEAD is invalid",
        emission: [head("not-a-sha")],
      },
      {
        label: "the worktree becomes dirty",
        emission: [head(shaA), status(" M vite.config.ts\n")],
      },
      {
        label: "Git status fails",
        emission: [
          head(shaA),
          {
            args: ["status", "--porcelain", "--untracked-files=all"],
            error: new Error("status unavailable"),
          },
        ],
      },
    ])("throws in strict mode when $label", ({ emission }) => {
      const sequence = createGitSequence([
        head(shaA),
        status(),
        ...emission,
      ]);
      const initialSha = resolveCleanGitHead(sequence.runGit);

      expect(() =>
        revalidateDeployedSha(initialSha, "strict", sequence.runGit),
      ).toThrow(/could not be revalidated/);
      sequence.expectComplete();
    });
  });

  it("stamps an exact approved SHA only after clean bundle-time revalidation", async () => {
    const deployedSha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const releaseEnv = {
      SNOTE_RELEASE_SHA: deployedSha,
      SNOTE_REQUIRE_RELEASE_SHA: "1",
    };

    if (resolveCleanGitHead() !== deployedSha) {
      await expect(
        withReleaseEnv(releaseEnv, emitVersionPayload),
      ).rejects.toThrow(/could not be revalidated/);
      return;
    }

    const version = await withReleaseEnv(releaseEnv, emitVersionPayload);

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

  it("stamps ordinary builds only when the real Git checkout is clean", async () => {
    const expectedSha = resolveCleanGitHead();
    const version = await withReleaseEnv({}, emitVersionPayload);

    expect(version.deployedSha).toBe(expectedSha);
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

  it("documents conditional normal-build identity without claiming production proof", () => {
    const readme = readFileSync("e2e/README.md", "utf8");
    const manifest = readFileSync(
      "docs/security/release-manifests/2026-07-capability-rollout.md",
      "utf8",
    );

    expect(readme).toContain("clean Git-backed normal build");
    expect(readme).toContain("dirty or Git-less build");
    expect(readme).toContain("Lovable preview/staging rehearsal");
    expect(manifest).toContain(
      "Status: `PREPARATION - NO PRODUCTION MUTATION AUTHORIZED`",
    );
    expect(manifest).toContain("Clean Git-backed normal provider builds");
    expect(manifest).toContain("Lovable preview/staging rehearsal");
    expect(manifest).toContain(
      "Observed production source-SHA attestation: `UNPROVEN",
    );
  });
});
