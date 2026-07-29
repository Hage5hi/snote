/** @vitest-environment node */

import { execFileSync } from "node:child_process";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  assertSafeOutputRoot,
  createPwaTransitionFixtureBuilder,
  type PwaTransitionFixtureBuilderOptions,
} from "../build-pwa-transition-fixtures";

type BuildInvocation = Readonly<{
  executable: string;
  args: readonly string[];
  options: Readonly<{
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: "inherit";
  }>;
}>;

type Sandbox = Readonly<{
  root: string;
  sourcePath: string;
  viteCli: string;
}>;

type FixtureWriteOptions = Readonly<{
  createAssets?: boolean;
  createIdentity?: boolean;
  rollupAssetPathnames?: unknown;
  versionOverrides?: Readonly<Record<string, unknown>>;
}>;

const DEFAULT_ASSET_PATHNAME = "/assets/index-AbCdEf12.js";
const cleanupRoots: string[] = [];

function cleanupRoot(root: string): void {
  const canonicalTmp = resolve(tmpdir());
  const canonicalRoot = resolve(root);
  if (
    canonicalRoot === canonicalTmp ||
    !canonicalRoot.startsWith(`${canonicalTmp}\\`) &&
      !canonicalRoot.startsWith(`${canonicalTmp}/`)
  ) {
    throw new Error("Refusing to clean a non-temporary test directory.");
  }
  rmSync(canonicalRoot, { force: true, recursive: true });
}

function probeSymlinkSupport(type: "dir" | "file"): boolean {
  const root = mkdtempSync(join(tmpdir(), "snote-pwa-symlink-probe-"));
  try {
    const target = resolve(root, "target");
    const link = resolve(root, "link");
    if (type === "dir") mkdirSync(target);
    else writeFileSync(target, "target", "utf8");
    symlinkSync(
      target,
      link,
      process.platform === "win32" && type === "dir" ? "junction" : type,
    );
    return lstatSync(link).isSymbolicLink();
  } catch {
    return false;
  } finally {
    cleanupRoot(root);
  }
}

const supportsDirectorySymlink = probeSymlinkSupport("dir");
const supportsFileSymlink = probeSymlinkSupport("file");

function createSandbox(options: { git?: boolean } = {}): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "snote-pwa-builder-"));
  cleanupRoots.push(root);
  const sourcePath = resolve(root, "src", "input.ts");
  const viteCli = resolve(root, "node_modules", "vite", "bin", "vite.js");
  mkdirSync(dirname(sourcePath), { recursive: true });
  mkdirSync(dirname(viteCli), { recursive: true });
  writeFileSync(sourcePath, 'export const input = "stable";\n', "utf8");
  writeFileSync(viteCli, "// test-only Vite entry\n", "utf8");

  if (options.git) {
    writeFileSync(
      resolve(root, ".gitignore"),
      "/.tmp/\n/node_modules/\n/ignored.log\n",
      "utf8",
    );
    execFileSync("git", ["init", "--quiet"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["add", "--", ".gitignore", "src/input.ts"], {
      cwd: root,
      stdio: "ignore",
    });
  }

  return { root, sourcePath, viteCli };
}

function createInvocationRecorder(
  writeFixture: (invocation: BuildInvocation) => void,
): {
  invocations: BuildInvocation[];
  runBuild: NonNullable<PwaTransitionFixtureBuilderOptions["runBuild"]>;
} {
  const invocations: BuildInvocation[] = [];
  return {
    invocations,
    runBuild(executable, args, options) {
      const invocation: BuildInvocation = {
        executable,
        args: [...args],
        options: {
          cwd: options.cwd,
          env: { ...options.env },
          stdio: options.stdio,
        },
      };
      invocations.push(invocation);
      writeFixture(invocation);
    },
  };
}

function outputRootFrom(invocation: BuildInvocation): string {
  const index = invocation.args.indexOf("--outDir");
  if (index === -1 || typeof invocation.args[index + 1] !== "string") {
    throw new Error("Test runner received a build without an exact outDir.");
  }
  return resolve(invocation.args[index + 1]);
}

function writeFixture(
  invocation: BuildInvocation,
  options: FixtureWriteOptions = {},
): void {
  const outputRoot = outputRootFrom(invocation);
  const buildId = invocation.options.env.SNOTE_PWA_TRANSITION_BUILD_ID;
  if (buildId !== "pwa-e2e-a" && buildId !== "pwa-e2e-b") {
    throw new Error("Test runner received an invalid fixture build ID.");
  }

  const identityHash =
    buildId === "pwa-e2e-a" ? "aaaaaaaaaaaaaaaa" : "bbbbbbbbbbbbbbbb";
  const workerIdentityPath = `/sw-identity-${identityHash}.js`;
  const workboxFilename = "workbox-deadbeef.js";
  const rollupAssetPathnames =
    options.rollupAssetPathnames ?? [DEFAULT_ASSET_PATHNAME];

  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(
    resolve(outputRoot, "version.json"),
    JSON.stringify({
      buildId,
      deployedSha: null,
      rollupAssetPathnames,
      workerIdentityPath,
      ...options.versionOverrides,
    }),
    "utf8",
  );
  writeFileSync(
    resolve(outputRoot, "sw.js"),
    `importScripts("${workerIdentityPath}","./${workboxFilename.slice(0, -3)}");`,
    "utf8",
  );
  writeFileSync(resolve(outputRoot, workboxFilename), "workbox", "utf8");

  if (options.createIdentity !== false) {
    writeFileSync(
      resolve(outputRoot, workerIdentityPath.slice(1)),
      "identity",
      "utf8",
    );
  }

  if (
    options.createAssets !== false &&
    Array.isArray(rollupAssetPathnames)
  ) {
    for (const pathname of rollupAssetPathnames) {
      if (
        typeof pathname !== "string" ||
        !/^\/assets\/[^/]+$/.test(pathname) ||
        pathname.length > 256
      ) {
        continue;
      }
      const assetPath = resolve(outputRoot, pathname.slice(1));
      mkdirSync(dirname(assetPath), { recursive: true });
      writeFileSync(assetPath, pathname, "utf8");
    }
  }
}

function createBuilder(
  sandbox: Sandbox,
  overrides: Partial<PwaTransitionFixtureBuilderOptions>,
) {
  return createPwaTransitionFixtureBuilder({
    repoRoot: sandbox.root,
    environment: Object.freeze({ TEST_MARKER: "preserved" }),
    listSourceInputs: () => [
      "src/input.ts",
      ".tmp/pwa-transition/a/generated.js",
      ".tmp/pwa-transition/b/generated.js",
    ],
    runBuild() {
      throw new Error("Unexpected build spawn.");
    },
    ...overrides,
  });
}

function readVersion(outputRoot: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(outputRoot, "version.json"), "utf8"),
  ) as Record<string, unknown>;
}

function writeVersion(
  outputRoot: string,
  version: Readonly<Record<string, unknown>>,
): void {
  writeFileSync(
    resolve(outputRoot, "version.json"),
    JSON.stringify(version),
    "utf8",
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  while (cleanupRoots.length > 0) {
    const root = cleanupRoots.pop();
    if (root) cleanupRoot(root);
  }
});

describe("PWA transition fixture builder", () => {
  it("accepts no output root outside the exact a/b fixture set", () => {
    const sandbox = createSandbox();
    const untrustedDirectory = "c" as "a";

    expect(() =>
      assertSafeOutputRoot(
        resolve(sandbox.root, ".tmp", "pwa-transition", "c"),
        untrustedDirectory,
        sandbox.root,
      ),
    ).toThrow(/exact a\/b child/i);
  });

  it("spawns only exact sequential A then B Vite builds with isolated identities", () => {
    const sandbox = createSandbox();
    const recorder = createInvocationRecorder((invocation) =>
      writeFixture(invocation),
    );
    const environment = Object.freeze({
      PATH: "test-path",
      TEST_MARKER: "preserved",
    });
    const builder = createBuilder(sandbox, {
      environment,
      runBuild: recorder.runBuild,
    });

    builder.build();

    const outputParent = resolve(sandbox.root, ".tmp", "pwa-transition");
    expect(recorder.invocations).toHaveLength(2);
    expect(recorder.invocations.map((invocation) => invocation.executable)).toEqual([
      process.execPath,
      process.execPath,
    ]);
    expect(recorder.invocations.map((invocation) => invocation.args)).toEqual([
      [
        sandbox.viteCli,
        "build",
        "--outDir",
        resolve(outputParent, "a"),
        "--emptyOutDir",
      ],
      [
        sandbox.viteCli,
        "build",
        "--outDir",
        resolve(outputParent, "b"),
        "--emptyOutDir",
      ],
    ]);
    expect(
      recorder.invocations.map((invocation) => ({
        cwd: invocation.options.cwd,
        stdio: invocation.options.stdio,
        buildId:
          invocation.options.env.SNOTE_PWA_TRANSITION_BUILD_ID,
        harness: invocation.options.env.SNOTE_PWA_TRANSITION_HARNESS,
        marker: invocation.options.env.TEST_MARKER,
        releaseKeys: [
          "SNOTE_REQUIRE_RELEASE_SHA",
          "SNOTE_RELEASE_SHA",
          "SNOTE_BUILD_ID",
        ].filter((key) => key in invocation.options.env),
      })),
    ).toEqual([
      {
        cwd: sandbox.root,
        stdio: "inherit",
        buildId: "pwa-e2e-a",
        harness: "1",
        marker: "preserved",
        releaseKeys: [],
      },
      {
        cwd: sandbox.root,
        stdio: "inherit",
        buildId: "pwa-e2e-b",
        harness: "1",
        marker: "preserved",
        releaseKeys: [],
      },
    ]);
    expect(environment).toEqual({
      PATH: "test-path",
      TEST_MARKER: "preserved",
    });
  });

  it("prevalidates both exact output roots before listing inputs or spawning", () => {
    const sandbox = createSandbox();
    const invalidRoot = resolve(
      sandbox.root,
      ".tmp",
      "pwa-transition",
      "b",
    );
    mkdirSync(dirname(invalidRoot), { recursive: true });
    writeFileSync(invalidRoot, "not a directory", "utf8");
    const runBuild = vi.fn();
    const listSourceInputs = vi.fn(() => ["src/input.ts"]);
    const builder = createBuilder(sandbox, {
      listSourceInputs,
      runBuild,
    });

    expect(() => builder.build()).toThrow(/non-direct directory/i);
    expect(listSourceInputs).not.toHaveBeenCalled();
    expect(runBuild).not.toHaveBeenCalled();
  });

  it.skipIf(!supportsDirectorySymlink)(
    "refuses a reparse-like output ancestor before listing inputs or spawning",
    () => {
      const sandbox = createSandbox();
      const outside = resolve(sandbox.root, "outside");
      const outputParent = resolve(sandbox.root, ".tmp", "pwa-transition");
      mkdirSync(outside, { recursive: true });
      mkdirSync(dirname(outputParent), { recursive: true });
      symlinkSync(
        outside,
        outputParent,
        process.platform === "win32" ? "junction" : "dir",
      );
      const runBuild = vi.fn();
      const listSourceInputs = vi.fn(() => ["src/input.ts"]);
      const builder = createBuilder(sandbox, {
        listSourceInputs,
        runBuild,
      });

      expect(() => builder.build()).toThrow(/non-direct|reparse/i);
      expect(listSourceInputs).not.toHaveBeenCalled();
      expect(runBuild).not.toHaveBeenCalled();
    },
  );

  it("does not spawn B after A fixture validation fails", () => {
    const sandbox = createSandbox();
    const recorder = createInvocationRecorder((invocation) => {
      writeFixture(invocation, {
        versionOverrides: { buildId: "wrong-build" },
      });
    });
    const builder = createBuilder(sandbox, {
      runBuild: recorder.runBuild,
    });

    expect(() => builder.build()).toThrow(/build ID/i);
    expect(recorder.invocations).toHaveLength(1);
    expect(
      recorder.invocations[0].options.env.SNOTE_PWA_TRANSITION_BUILD_ID,
    ).toBe("pwa-e2e-a");
  });

  it("fails before B when a source input changes while A builds", () => {
    const sandbox = createSandbox();
    const recorder = createInvocationRecorder((invocation) => {
      writeFixture(invocation);
      writeFileSync(
        sandbox.sourcePath,
        'export const input = "changed-during-a";\n',
        "utf8",
      );
    });
    const builder = createBuilder(sandbox, {
      listSourceInputs: () => ["src/input.ts"],
      runBuild: recorder.runBuild,
    });

    expect(() => builder.build()).toThrow(/source inputs changed/i);
    expect(recorder.invocations).toHaveLength(1);
  });

  it("fails after B when a source input changes while B builds", () => {
    const sandbox = createSandbox();
    const recorder = createInvocationRecorder((invocation) => {
      writeFixture(invocation);
      if (
        invocation.options.env.SNOTE_PWA_TRANSITION_BUILD_ID === "pwa-e2e-b"
      ) {
        writeFileSync(
          sandbox.sourcePath,
          'export const input = "changed-during-b";\n',
          "utf8",
        );
      }
    });
    const builder = createBuilder(sandbox, {
      listSourceInputs: () => ["src/input.ts"],
      runBuild: recorder.runBuild,
    });

    expect(() => builder.build()).toThrow(/source inputs changed/i);
    expect(recorder.invocations).toHaveLength(2);
  });

  it("detects a newly added non-ignored input between checkpoints", () => {
    const sandbox = createSandbox();
    const addedPath = resolve(sandbox.root, "src", "added.ts");
    let added = false;
    const recorder = createInvocationRecorder((invocation) => {
      writeFixture(invocation);
      writeFileSync(addedPath, "export {};\n", "utf8");
      added = true;
    });
    const builder = createBuilder(sandbox, {
      listSourceInputs: () =>
        added ? ["src/input.ts", "src/added.ts"] : ["src/input.ts"],
      runBuild: recorder.runBuild,
    });

    expect(() => builder.build()).toThrow(/source inputs changed/i);
    expect(recorder.invocations).toHaveLength(1);
  });

  it("uses Git-visible inputs while excluding generated and ignored outputs", () => {
    const sandbox = createSandbox({ git: true });
    const recorder = createInvocationRecorder((invocation) => {
      writeFixture(invocation);
      writeFileSync(
        resolve(sandbox.root, "ignored.log"),
        `${invocation.options.env.SNOTE_PWA_TRANSITION_BUILD_ID}\n`,
        "utf8",
      );
    });
    const builder = createPwaTransitionFixtureBuilder({
      repoRoot: sandbox.root,
      environment: Object.freeze({ TEST_MARKER: "preserved" }),
      runBuild: recorder.runBuild,
    });

    builder.build();

    expect(recorder.invocations).toHaveLength(2);
  });

  it.each([
    {
      label: "an empty manifest",
      manifest: [],
    },
    {
      label: "an oversized manifest",
      manifest: Array.from(
        { length: 513 },
        (_, index) =>
          `/assets/chunk-${index.toString().padStart(4, "0")}-AbCdEf12.js`,
      ),
    },
    {
      label: "an unsorted manifest",
      manifest: [
        "/assets/z-AbCdEf12.js",
        "/assets/a-AbCdEf12.js",
      ],
    },
    {
      label: "a duplicate manifest entry",
      manifest: [DEFAULT_ASSET_PATHNAME, DEFAULT_ASSET_PATHNAME],
    },
    {
      label: "a nested asset pathname",
      manifest: ["/assets/nested/index-AbCdEf12.js"],
    },
    {
      label: "an unbounded asset pathname",
      manifest: [
        `/assets/${"a".repeat(240)}-AbCdEf12.js`,
      ],
    },
    {
      label: "an asset without an eight-character content hash",
      manifest: ["/assets/index-short.js"],
    },
  ])("rejects $label before any later spawn", ({ manifest }) => {
    const sandbox = createSandbox();
    const recorder = createInvocationRecorder((invocation) =>
      writeFixture(invocation, {
        createAssets: false,
        rollupAssetPathnames: manifest,
      }),
    );
    const builder = createBuilder(sandbox, {
      runBuild: recorder.runBuild,
    });

    expect(() => builder.build()).toThrow(/asset manifest/i);
    expect(recorder.invocations).toHaveLength(1);
  });

  it("requires every declared manifest asset to be a regular file", () => {
    const sandbox = createSandbox();
    const recorder = createInvocationRecorder((invocation) =>
      writeFixture(invocation, { createAssets: false }),
    );
    const builder = createBuilder(sandbox, {
      runBuild: recorder.runBuild,
    });

    expect(() => builder.build()).toThrow(/static asset file/i);
    expect(recorder.invocations).toHaveLength(1);
  });

  it.skipIf(!supportsDirectorySymlink)(
    "rejects a declared asset whose real path escapes the output root",
    () => {
      const sandbox = createSandbox();
      const outside = resolve(sandbox.root, "outside-assets");
      mkdirSync(outside, { recursive: true });
      writeFileSync(
        resolve(outside, DEFAULT_ASSET_PATHNAME.split("/").at(-1)!),
        "outside",
        "utf8",
      );
      const recorder = createInvocationRecorder((invocation) => {
        writeFixture(invocation, { createAssets: false });
        symlinkSync(
          outside,
          resolve(outputRootFrom(invocation), "assets"),
          process.platform === "win32" ? "junction" : "dir",
        );
      });
      const builder = createBuilder(sandbox, {
        runBuild: recorder.runBuild,
      });

      expect(() => builder.build()).toThrow(/static asset file/i);
      expect(recorder.invocations).toHaveLength(1);
    },
  );

  it.skipIf(!supportsFileSymlink)(
    "rejects a symlinked worker identity before any later spawn",
    () => {
      const sandbox = createSandbox();
      const outsideIdentity = resolve(sandbox.root, "outside-identity.js");
      writeFileSync(outsideIdentity, "outside", "utf8");
      const recorder = createInvocationRecorder((invocation) => {
        writeFixture(invocation, { createIdentity: false });
        const version = readVersion(outputRootFrom(invocation));
        symlinkSync(
          outsideIdentity,
          resolve(
            outputRootFrom(invocation),
            String(version.workerIdentityPath).slice(1),
          ),
          "file",
        );
      });
      const builder = createBuilder(sandbox, {
        runBuild: recorder.runBuild,
      });

      expect(() => builder.build()).toThrow(/worker identity file/i);
      expect(recorder.invocations).toHaveLength(1);
    },
  );

  it("requires the version manifest to contain exactly the trusted keys", () => {
    const sandbox = createSandbox();
    const recorder = createInvocationRecorder((invocation) => {
      writeFixture(invocation);
      const outputRoot = outputRootFrom(invocation);
      writeVersion(outputRoot, {
        ...readVersion(outputRoot),
        unexpected: "value",
      });
    });
    const builder = createBuilder(sandbox, {
      runBuild: recorder.runBuild,
    });

    expect(() => builder.build()).toThrow(/exactly four keys/i);
    expect(recorder.invocations).toHaveLength(1);
  });

  it("preserves the generated Workbox module specifier without a .js suffix", () => {
    const sandbox = createSandbox();
    const recorder = createInvocationRecorder((invocation) => {
      writeFixture(invocation);
      const outputRoot = outputRootFrom(invocation);
      writeFileSync(
        resolve(outputRoot, "sw.js"),
        readFileSync(resolve(outputRoot, "sw.js"), "utf8").replace(
          "./workbox-deadbeef",
          "./workbox-deadbeef.js",
        ),
        "utf8",
      );
    });
    const builder = createBuilder(sandbox, {
      runBuild: recorder.runBuild,
    });

    expect(() => builder.build()).toThrow(/does not reference/i);
    expect(recorder.invocations).toHaveLength(1);
  });
});
