import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const OUTPUT_PARENT = resolve(REPO_ROOT, ".tmp", "pwa-transition");
const VITE_CLI = resolve(REPO_ROOT, "node_modules", "vite", "bin", "vite.js");
const RELEASE_IDENTITY_ENV_KEYS = [
  "SNOTE_REQUIRE_RELEASE_SHA",
  "SNOTE_RELEASE_SHA",
  "SNOTE_BUILD_ID",
] as const;
const VERSION_KEYS = [
  "buildId",
  "deployedSha",
  "rollupAssetPathnames",
  "workerIdentityPath",
] as const;
const FIXTURES = [
  {
    directory: "a",
    buildId: "pwa-e2e-a",
  },
  {
    directory: "b",
    buildId: "pwa-e2e-b",
  },
] as const;
const ALLOWED_ROLLUP_ASSET_PATHNAME =
  /^\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*-[A-Za-z0-9_-]{8}\.(?:css|js|mjs|json|png|jpe?g|gif|svg|webp|ico|woff2?|ttf)$/;
const MAX_ROLLUP_ASSET_PATHNAMES = 512;
const MAX_ROLLUP_ASSET_PATHNAME_LENGTH = 256;
const MAX_SOURCE_INPUTS = 50_000;
const MAX_SOURCE_INPUT_PATH_LENGTH = 4_096;

type Fixture = (typeof FIXTURES)[number];

type VersionPayload = {
  buildId: unknown;
  deployedSha: unknown;
  rollupAssetPathnames: unknown;
  workerIdentityPath: unknown;
};

export type PwaTransitionBuildOptions = Readonly<{
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: "inherit";
}>;

export type PwaTransitionFixtureBuilderOptions = Readonly<{
  repoRoot: string;
  environment: Readonly<NodeJS.ProcessEnv>;
  listSourceInputs?: () => readonly string[];
  runBuild?: (
    executable: string,
    args: readonly string[],
    options: PwaTransitionBuildOptions,
  ) => void;
}>;

function normalizedPath(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function pathsEqual(left: string, right: string): boolean {
  return normalizedPath(resolve(left)) === normalizedPath(resolve(right));
}

function isPathWithin(parent: string, candidate: string): boolean {
  const relation = relative(resolve(parent), resolve(candidate));
  return (
    relation === "" ||
    (!isAbsolute(relation) &&
      relation !== ".." &&
      !relation.startsWith(`..${sep}`))
  );
}

function assertExistingDirectoryIsDirect(pathname: string): void {
  if (!existsSync(pathname)) return;

  let stats;
  try {
    stats = lstatSync(pathname);
  } catch {
    throw new Error(
      `Unable to verify PWA transition output directory: ${pathname}`,
    );
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(
      `Refusing PWA transition output through a non-direct directory: ${pathname}`,
    );
  }

  let canonicalPath: string;
  try {
    canonicalPath = realpathSync.native(pathname);
  } catch {
    throw new Error(
      `Unable to verify PWA transition output directory: ${pathname}`,
    );
  }
  if (!pathsEqual(canonicalPath, pathname)) {
    throw new Error(
      `Refusing PWA transition output through a reparse-like directory: ${pathname}`,
    );
  }
}

export function assertSafeOutputRoot(
  outputRoot: string,
  directory: Fixture["directory"],
  repoRoot = REPO_ROOT,
): void {
  const resolvedRepoRoot = resolve(repoRoot);
  const outputParent = resolve(
    resolvedRepoRoot,
    ".tmp",
    "pwa-transition",
  );
  const expectedRoot = resolve(outputParent, directory);
  if (
    (directory !== "a" && directory !== "b") ||
    !pathsEqual(outputRoot, expectedRoot) ||
    !pathsEqual(dirname(resolve(outputRoot)), outputParent)
  ) {
    throw new Error(
      "PWA transition output must be an exact a/b child of .tmp/pwa-transition.",
    );
  }

  assertExistingDirectoryIsDirect(resolvedRepoRoot);
  assertExistingDirectoryIsDirect(resolve(resolvedRepoRoot, ".tmp"));
  assertExistingDirectoryIsDirect(outputParent);
  assertExistingDirectoryIsDirect(expectedRoot);
}

function assertRegularFileWithin(
  boundaryRoot: string,
  pathname: string,
  label: string,
): void {
  const resolvedBoundary = resolve(boundaryRoot);
  const resolvedPathname = resolve(pathname);
  if (
    pathsEqual(resolvedBoundary, resolvedPathname) ||
    !isPathWithin(resolvedBoundary, resolvedPathname)
  ) {
    throw new Error(`Invalid ${label}: ${resolvedPathname}`);
  }
  if (!existsSync(resolvedPathname)) {
    throw new Error(`Missing ${label}: ${resolvedPathname}`);
  }

  let stats;
  let canonicalPath: string;
  try {
    stats = lstatSync(resolvedPathname);
    canonicalPath = realpathSync.native(resolvedPathname);
  } catch {
    throw new Error(`Unable to verify ${label}: ${resolvedPathname}`);
  }
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    !pathsEqual(canonicalPath, resolvedPathname) ||
    !isPathWithin(resolvedBoundary, canonicalPath)
  ) {
    throw new Error(`Invalid ${label}: ${resolvedPathname}`);
  }
}

function readVersion(outputRoot: string): VersionPayload {
  const versionPath = resolve(outputRoot, "version.json");
  assertRegularFileWithin(outputRoot, versionPath, "version manifest");

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(versionPath, "utf8"));
  } catch {
    throw new Error(`Invalid PWA transition version.json: ${versionPath}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid PWA transition version.json: ${versionPath}`);
  }
  return parsed as VersionPayload;
}

function validateRollupAssetPathnames(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_ROLLUP_ASSET_PATHNAMES
  ) {
    throw new Error("Invalid PWA transition static asset manifest.");
  }

  const validated: string[] = [];
  for (const pathname of value) {
    if (
      typeof pathname !== "string" ||
      pathname.length > MAX_ROLLUP_ASSET_PATHNAME_LENGTH ||
      !ALLOWED_ROLLUP_ASSET_PATHNAME.test(pathname) ||
      (validated.length > 0 &&
        validated[validated.length - 1] >= pathname)
    ) {
      throw new Error("Invalid PWA transition static asset manifest.");
    }
    validated.push(pathname);
  }
  return validated;
}

function validateFixture(
  outputRoot: string,
  fixture: Fixture,
  previousIdentityPath: string | null,
  repoRoot: string,
): string {
  assertSafeOutputRoot(outputRoot, fixture.directory, repoRoot);
  const version = readVersion(outputRoot);
  if (
    JSON.stringify(Object.keys(version).sort()) !==
    JSON.stringify([...VERSION_KEYS].sort())
  ) {
    throw new Error("PWA transition version.json must contain exactly four keys.");
  }
  if (version.buildId !== fixture.buildId) {
    throw new Error(`Unexpected PWA transition build ID for ${fixture.buildId}.`);
  }
  if (version.deployedSha !== null) {
    throw new Error("PWA transition fixtures must not attest a deployed SHA.");
  }

  const rollupAssetPathnames = validateRollupAssetPathnames(
    version.rollupAssetPathnames,
  );
  for (const pathname of rollupAssetPathnames) {
    assertRegularFileWithin(
      outputRoot,
      resolve(outputRoot, pathname.slice(1)),
      "static asset file",
    );
  }

  if (
    typeof version.workerIdentityPath !== "string" ||
    !/^\/sw-identity-[a-f0-9]{16}\.js$/.test(version.workerIdentityPath)
  ) {
    throw new Error("Invalid PWA transition worker identity path.");
  }
  if (version.workerIdentityPath === previousIdentityPath) {
    throw new Error("PWA transition fixtures must use distinct worker identities.");
  }

  const identityPath = resolve(
    outputRoot,
    version.workerIdentityPath.slice(1),
  );
  assertRegularFileWithin(outputRoot, identityPath, "worker identity file");

  const serviceWorkerPath = resolve(outputRoot, "sw.js");
  assertRegularFileWithin(outputRoot, serviceWorkerPath, "service worker");

  const outputFiles = readdirSync(outputRoot, { withFileTypes: true });
  const workboxFiles = outputFiles.filter(
    (entry) =>
      entry.isFile() && /^workbox-[a-f0-9]{8}\.js$/.test(entry.name),
  );
  if (workboxFiles.length !== 1) {
    throw new Error("PWA transition fixture must contain exactly one Workbox file.");
  }
  const workboxFile = workboxFiles[0];
  assertRegularFileWithin(
    outputRoot,
    resolve(outputRoot, workboxFile.name),
    "Workbox file",
  );

  const serviceWorker = readFileSync(serviceWorkerPath, "utf8");
  const workboxModuleSpecifier = `./${workboxFile.name.slice(
    0,
    -".js".length,
  )}`;
  const referencesIdentity =
    serviceWorker.includes(`"${version.workerIdentityPath}"`) ||
    serviceWorker.includes(`'${version.workerIdentityPath}'`);
  const referencesWorkbox =
    serviceWorker.includes(`"${workboxModuleSpecifier}"`) ||
    serviceWorker.includes(`'${workboxModuleSpecifier}'`);
  if (!referencesIdentity || !referencesWorkbox) {
    throw new Error(
      "PWA transition service worker does not reference its validated identity and Workbox files.",
    );
  }

  return version.workerIdentityPath;
}

function listGitVisibleSourceInputs(repoRoot: string): readonly string[] {
  let output: string;
  try {
    output = execFileSync(
      "git",
      [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch {
    throw new Error("Unable to enumerate PWA transition source inputs.");
  }
  return output === "" ? [] : output.split("\0").filter(Boolean);
}

function validatedSourceInputPaths(
  repoRoot: string,
  outputParent: string,
  listSourceInputs: () => readonly string[],
): readonly string[] {
  let listed: readonly string[];
  try {
    listed = listSourceInputs();
  } catch {
    throw new Error("Unable to enumerate PWA transition source inputs.");
  }
  if (!Array.isArray(listed) || listed.length > MAX_SOURCE_INPUTS) {
    throw new Error("Invalid PWA transition source input list.");
  }

  const validated: string[] = [];
  const seen = new Set<string>();
  for (const relativePath of listed) {
    if (
      typeof relativePath !== "string" ||
      relativePath.length === 0 ||
      relativePath.length > MAX_SOURCE_INPUT_PATH_LENGTH ||
      isAbsolute(relativePath)
    ) {
      throw new Error("Invalid PWA transition source input path.");
    }

    const pathname = resolve(repoRoot, relativePath);
    if (!isPathWithin(repoRoot, pathname)) {
      throw new Error("Invalid PWA transition source input path.");
    }
    if (isPathWithin(outputParent, pathname)) {
      continue;
    }

    const normalizedRelativePath = relative(repoRoot, pathname).replaceAll(
      "\\",
      "/",
    );
    if (seen.has(normalizedRelativePath)) {
      throw new Error("Duplicate PWA transition source input path.");
    }
    seen.add(normalizedRelativePath);
    validated.push(normalizedRelativePath);
  }

  return validated.sort();
}

function fingerprintSourceInputs(
  repoRoot: string,
  outputParent: string,
  listSourceInputs: () => readonly string[],
): string {
  const sourceInputPaths = validatedSourceInputPaths(
    repoRoot,
    outputParent,
    listSourceInputs,
  );
  const hash = createHash("sha256");

  for (const relativePath of sourceInputPaths) {
    const pathname = resolve(repoRoot, relativePath);
    assertRegularFileWithin(repoRoot, pathname, "source input file");
    const before = lstatSync(pathname, { bigint: true });
    const contents = readFileSync(pathname);
    const after = lstatSync(pathname, { bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) {
      throw new Error(
        "PWA transition source inputs changed while being fingerprinted.",
      );
    }

    const relativePathBytes = Buffer.byteLength(relativePath, "utf8");
    hash.update(`${relativePathBytes}:`, "utf8");
    hash.update(relativePath, "utf8");
    hash.update(`:${contents.byteLength}:`, "utf8");
    hash.update(contents);
  }

  const revalidatedPaths = validatedSourceInputPaths(
    repoRoot,
    outputParent,
    listSourceInputs,
  );
  if (
    sourceInputPaths.length !== revalidatedPaths.length ||
    sourceInputPaths.some(
      (relativePath, index) => relativePath !== revalidatedPaths[index],
    )
  ) {
    throw new Error(
      "PWA transition source inputs changed while being fingerprinted.",
    );
  }

  return hash.digest("hex");
}

function defaultRunBuild(
  executable: string,
  args: readonly string[],
  options: PwaTransitionBuildOptions,
): void {
  execFileSync(executable, [...args], options);
}

export function createPwaTransitionFixtureBuilder(
  options: PwaTransitionFixtureBuilderOptions,
): {
  build(): void;
} {
  if (
    typeof options !== "object" ||
    options === null ||
    typeof options.repoRoot !== "string" ||
    options.repoRoot.length === 0 ||
    typeof options.environment !== "object" ||
    options.environment === null
  ) {
    throw new Error("Invalid PWA transition fixture builder options.");
  }

  const repoRoot = resolve(options.repoRoot);
  const outputParent = resolve(repoRoot, ".tmp", "pwa-transition");
  const viteCli = resolve(repoRoot, "node_modules", "vite", "bin", "vite.js");
  const listSourceInputs =
    options.listSourceInputs ??
    (() => listGitVisibleSourceInputs(repoRoot));
  const runBuild = options.runBuild ?? defaultRunBuild;

  return {
    build(): void {
      const conflictingKey = RELEASE_IDENTITY_ENV_KEYS.find(
        (key) => options.environment[key] !== undefined,
      );
      if (conflictingKey) {
        throw new Error(
          `PWA transition fixtures cannot inherit release identity variable ${conflictingKey}.`,
        );
      }

      const outputRoots = FIXTURES.map((fixture) => ({
        fixture,
        outputRoot: resolve(outputParent, fixture.directory),
      }));
      for (const { fixture, outputRoot } of outputRoots) {
        assertSafeOutputRoot(outputRoot, fixture.directory, repoRoot);
      }
      assertRegularFileWithin(repoRoot, viteCli, "Vite CLI");

      const initialSourceFingerprint = fingerprintSourceInputs(
        repoRoot,
        outputParent,
        listSourceInputs,
      );
      let previousIdentityPath: string | null = null;

      for (const { fixture, outputRoot } of outputRoots) {
        assertSafeOutputRoot(outputRoot, fixture.directory, repoRoot);
        runBuild(
          process.execPath,
          [viteCli, "build", "--outDir", outputRoot, "--emptyOutDir"],
          {
            cwd: repoRoot,
            env: {
              ...options.environment,
              SNOTE_PWA_TRANSITION_HARNESS: "1",
              SNOTE_PWA_TRANSITION_BUILD_ID: fixture.buildId,
            },
            stdio: "inherit",
          },
        );
        previousIdentityPath = validateFixture(
          outputRoot,
          fixture,
          previousIdentityPath,
          repoRoot,
        );

        const currentSourceFingerprint = fingerprintSourceInputs(
          repoRoot,
          outputParent,
          listSourceInputs,
        );
        if (currentSourceFingerprint !== initialSourceFingerprint) {
          throw new Error(
            "PWA transition source inputs changed between fixture builds.",
          );
        }
      }
    },
  };
}

export function buildPwaTransitionFixtures(): void {
  createPwaTransitionFixtureBuilder({
    repoRoot: REPO_ROOT,
    environment: process.env,
  }).build();
}

if (
  process.argv[1] !== undefined &&
  pathsEqual(resolve(process.argv[1]), SCRIPT_PATH)
) {
  try {
    buildPwaTransitionFixtures();
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "PWA transition fixture build failed.",
    );
    process.exitCode = 1;
  }
}
