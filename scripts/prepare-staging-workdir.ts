import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_REPO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const PRODUCTION_PROJECT_REF = "onfzjmfjldsbthchssfr";
const LOCAL_PROJECT_ID = "snote-staging-local";
const ATOMIC_CUTOVER = "20260724000000_atomic_capability_cutover.sql";
const APPROVED_MIGRATIONS = [
  "20260302004416_1f426076-1b70-40b2-b64d-2469de8d3877.sql",
  "20260302005759_1d85738f-bd48-437f-8bee-ec57341c295e.sql",
  "20260302011021_fa7cadc9-65e5-495e-b9b1-da66eaee8d7b.sql",
  "20260302022256_f0c1c807-948c-4301-a4ae-07787722a937.sql",
  "20260302154947_ea0fdfed-0614-4a13-ab36-ad69927bd225.sql",
  "20260320210302_a87bc0ac-5ce1-42c8-ae5c-b284e6d185a7.sql",
  "20260320210849_9a7c7fe3-890a-46f3-b836-c0f003a84c0b.sql",
  "20260419225907_132b81c1-92f7-4aab-bd60-7136679e518c.sql",
  "20260419235758_85c29c59-c1af-460b-a986-b6706ea3019e.sql",
  "20260420010539_f771c643-6963-4ddb-9212-939649771d8a.sql",
  "20260420041258_01f4e8f4-7ae1-49f4-a144-14f107a60c09.sql",
  "20260420180403_68c28749-9453-4a4e-a68b-e774eb1bad2c.sql",
  "20260422132016_efe5dfa3-9e43-4e1c-adda-7496f4193a96.sql",
  "20260425000000_drop_leftover_buckets.sql",
  "20260425001208_6b7763c4-4e86-4ee7-ba9e-239b1c853e41.sql",
  "20260427041711_828a9986-2e8b-4be4-8149-2cbdcf2e1361.sql",
  "20260427041811_c85199ea-e258-4488-8a2a-f3bc1e707660.sql",
  "20260522000000_admin_rate_limit.sql",
  "20260719000000_security_immediate_containment.sql",
  "20260722000000_capability_backend.sql",
  "20260723000000_capability_checkpoint_compaction.sql",
  "20260727000000_capability_sync_conflict_codes.sql",
] as const;

export type PrepareStagingWorkdirOptions = Readonly<{
  repoRoot?: string;
  tempParent?: string;
}>;

function isWithin(parent: string, candidate: string): boolean {
  const relation = relative(resolve(parent), resolve(candidate));
  return relation === "" || (
    !isAbsolute(relation) &&
    relation !== ".." &&
    !relation.startsWith(`..${sep}`)
  );
}

function assertRegularFile(path: string, label: string): void {
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new Error(`Missing or invalid ${label}: ${path}`);
  }
}

function assertDirectory(path: string, label: string): void {
  if (!existsSync(path) || !lstatSync(path).isDirectory()) {
    throw new Error(`Missing or invalid ${label}: ${path}`);
  }
}

function canonicalDirectory(path: string, label: string): string {
  assertDirectory(path, label);
  try {
    return realpathSync.native(path);
  } catch {
    throw new Error(`Unable to resolve ${label}: ${path}`);
  }
}

function runGit(repoRoot: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

type SourceSnapshot = Readonly<{
  commit: string;
  paths: readonly string[];
}>;

function readCleanSourceSnapshot(repoRoot: string): SourceSnapshot {
  let commit: string;
  let status: string;
  let tree: string;
  try {
    commit = runGit(repoRoot, ["rev-parse", "HEAD^{commit}"]).trim();
    status = runGit(repoRoot, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--ignored=matching",
      "--",
      "supabase/config.toml",
      "supabase/functions",
      "supabase/migrations",
    ]);
    tree = runGit(repoRoot, [
      "ls-tree",
      "-r",
      "-z",
      commit,
      "--",
      "supabase/config.toml",
      "supabase/functions",
      "supabase/migrations",
    ]);
  } catch {
    throw new Error("Unable to verify the staging source checkout.");
  }
  if (!/^[0-9a-f]{40}$/.test(commit) || status !== "") {
    throw new Error("Staging Supabase sources must match a clean Git commit.");
  }
  const paths = tree.split("\0").filter(Boolean).map((entry) => {
    const separator = entry.indexOf("\t");
    if (
      separator < 0 ||
      !/^100(?:644|755) blob [0-9a-f]{40}$/.test(entry.slice(0, separator))
    ) {
      throw new Error("Staging Supabase sources must be tracked regular files.");
    }
    const path = entry.slice(separator + 1);
    const basename = path.split("/").at(-1)?.toLowerCase();
    if (
      path.startsWith("supabase/functions/") &&
      (basename === ".env" || basename?.startsWith(".env."))
    ) {
      throw new Error("Staging Edge Function environment files are forbidden.");
    }
    return path;
  }).sort();
  if (paths.length === 0) {
    throw new Error("Staging Supabase sources must be tracked regular files.");
  }
  return { commit, paths };
}

function rewriteConfig(source: string): string {
  const projectAssignments = source.match(/^project_id\s*=\s*"[^"\r\n]*"\s*$/gm) ?? [];
  if (projectAssignments.length !== 1) {
    throw new Error("Supabase config must contain exactly one project_id assignment.");
  }
  const rewritten = source.replace(
    /^project_id\s*=\s*"[^"\r\n]*"\s*$/m,
    `project_id = "${LOCAL_PROJECT_ID}"`,
  );
  if (rewritten.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error("Generated Supabase config retained the production project reference.");
  }
  return rewritten;
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function prepareStagingWorkdir(
  options: PrepareStagingWorkdirOptions = {},
): { workdir: string; manifestPath: string } {
  const repoRoot = canonicalDirectory(
    resolve(options.repoRoot ?? DEFAULT_REPO_ROOT),
    "source checkout",
  );
  const tempParent = canonicalDirectory(
    resolve(options.tempParent ?? tmpdir()),
    "temporary output parent",
  );
  const supabaseRoot = resolve(repoRoot, "supabase");
  const configPath = resolve(supabaseRoot, "config.toml");
  const functionsPath = resolve(supabaseRoot, "functions");
  const migrationsPath = resolve(supabaseRoot, "migrations");

  if (isWithin(repoRoot, tempParent)) {
    throw new Error("Staging output parent must be outside the source checkout.");
  }
  if (
    existsSync(resolve(supabaseRoot, ".temp/project-ref")) ||
    existsSync(resolve(supabaseRoot, ".branches"))
  ) {
    throw new Error("Refusing to prepare staging from a linked Supabase source tree.");
  }
  assertRegularFile(configPath, "Supabase config");
  assertDirectory(functionsPath, "Edge Functions directory");
  assertDirectory(migrationsPath, "migration directory");

  const snapshot = readCleanSourceSnapshot(repoRoot);
  const expectedSourceMigrations = [...APPROVED_MIGRATIONS, ATOMIC_CUTOVER]
    .map((file) => `supabase/migrations/${file}`)
    .sort();
  const sourceMigrations = snapshot.paths
    .filter((path) => path.startsWith("supabase/migrations/"));
  if (JSON.stringify(sourceMigrations) !== JSON.stringify(expectedSourceMigrations)) {
    throw new Error("Missing or unexpected source migration for the staging selection.");
  }
  if (!snapshot.paths.includes("supabase/config.toml")) {
    throw new Error("Supabase config must be tracked by Git.");
  }

  const functionPrefix = "supabase/functions/";
  const functionFiles = snapshot.paths
    .filter((path) => path.startsWith(functionPrefix))
    .map((path) => path.slice(functionPrefix.length));
  if (functionFiles.length === 0) {
    throw new Error("No tracked Edge Function sources were found.");
  }
  const rewrittenConfig = rewriteConfig(readFileSync(configPath, "utf8"));
  let createdRoot: string | undefined;
  try {
    createdRoot = mkdtempSync(join(tempParent, "snote-g3a-"));
    const canonicalRoot = realpathSync.native(createdRoot);
    if (
      !isWithin(tempParent, canonicalRoot) ||
      canonicalRoot === tempParent ||
      isWithin(repoRoot, canonicalRoot)
    ) {
      throw new Error("Staging output must resolve outside the source checkout.");
    }
    const generatedSupabase = resolve(canonicalRoot, "supabase");
    const generatedMigrations = resolve(generatedSupabase, "migrations");
    mkdirSync(generatedMigrations, { recursive: true });
    const generatedConfig = resolve(generatedSupabase, "config.toml");
    writeFileSync(generatedConfig, rewrittenConfig, "utf8");

    const generatedFunctions = resolve(generatedSupabase, "functions");
    const functionArtifacts = functionFiles.map((file) => {
      const sourcePath = resolve(functionsPath, file);
      assertRegularFile(sourcePath, "Edge Function source");
      const outputPath = resolve(generatedFunctions, file);
      mkdirSync(dirname(outputPath), { recursive: true });
      cpSync(sourcePath, outputPath);
      return {
        file: `supabase/functions/${file}`,
        sha256: hashFile(outputPath),
      };
    });

    const migrationArtifacts = APPROVED_MIGRATIONS.map((file) => {
      const sourcePath = resolve(migrationsPath, file);
      assertRegularFile(sourcePath, "source migration");
      const outputPath = resolve(generatedMigrations, file);
      cpSync(sourcePath, outputPath);
      return {
        file: `supabase/migrations/${file}`,
        sha256: hashFile(outputPath),
      };
    });
    const finalSnapshot = readCleanSourceSnapshot(repoRoot);
    if (
      finalSnapshot.commit !== snapshot.commit ||
      JSON.stringify(finalSnapshot.paths) !== JSON.stringify(snapshot.paths)
    ) {
      throw new Error("Staging Supabase sources changed while being copied.");
    }
    const manifest = {
      sourceCommit: snapshot.commit,
      files: [
        {
          file: "supabase/config.toml",
          sha256: hashFile(generatedConfig),
        },
        ...functionArtifacts,
        ...migrationArtifacts,
      ].sort((left, right) => left.file.localeCompare(right.file)),
    };
    const manifestPath = resolve(canonicalRoot, "staging-manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return { workdir: canonicalRoot, manifestPath };
  } catch (error) {
    if (createdRoot) rmSync(createdRoot, { recursive: true, force: true });
    throw error;
  }
}

if (import.meta.main) {
  const result = prepareStagingWorkdir();
  console.log(`Staging workdir: ${result.workdir}`);
  console.log(`Manifest: ${result.manifestPath}`);
}
